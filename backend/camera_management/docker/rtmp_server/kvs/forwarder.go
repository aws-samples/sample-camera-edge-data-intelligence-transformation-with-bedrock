// Package kvs implements AWS Kinesis Video Streams forwarding.
package kvs

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Forwarder forwards H.264 video to AWS Kinesis Video Streams.
type Forwarder struct {
	streamName string
	awsRegion  string

	mutex    sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	running  bool
	stopped  bool // true when explicitly stopped (not auto-restart)
	
	// Frame statistics
	frameCount uint64
	lastLogTime time.Time
	
	// Credential management
	credManager *CredentialManager
	
	// Auto-restart
	restartCount    int
	lastRestartTime time.Time
}

// NewForwarder creates a new KVS forwarder.
func NewForwarder(streamName, awsRegion string) *Forwarder {
	return &Forwarder{
		streamName:  streamName,
		awsRegion:   awsRegion,
		lastLogTime: time.Now(),
		credManager: NewCredentialManager(),
	}
}

// Start starts the GStreamer pipeline for KVS forwarding.
func (f *Forwarder) Start() error {
	f.mutex.Lock()
	defer f.mutex.Unlock()

	if f.running {
		return nil
	}

	log.Printf("[KVS] Starting GStreamer pipeline for stream: %s in region: %s", f.streamName, f.awsRegion)

	// Refresh AWS credentials before starting pipeline (ECS Fargate)
	if err := f.credManager.RefreshCredentials(); err != nil {
		log.Printf("[KVS] ⚠️  Failed to refresh credentials: %v (continuing with existing credentials)", err)
	}

	// Get optional KVS parameters from environment
	retentionPeriod := os.Getenv("RETENTION_PERIOD")
	if retentionPeriod == "" {
		retentionPeriod = "24"
	}

	fragmentDuration := os.Getenv("FRAGMENT_DURATION")
	if fragmentDuration == "" {
		fragmentDuration = "2000"
	}

	storageSize := os.Getenv("STORAGE_SIZE")
	if storageSize == "" {
		storageSize = "512"
	}

	// Build GStreamer pipeline
	// Input: H.264 Annex B byte stream from stdin
	// Output: KVS via kvssink
	// Note: do-timestamp=true ensures GStreamer generates timestamps for the incoming data
	// Added queue with large buffer to handle bursty input from mobile devices
	f.cmd = exec.Command("gst-launch-1.0", "-v",
		"fdsrc", "fd=0", "do-timestamp=true", "blocksize=1048576",
		"!", "queue", "max-size-buffers=0", "max-size-time=0", "max-size-bytes=10485760",
		"!", "h264parse",
		"!", "video/x-h264,stream-format=avc,alignment=au",
		"!", "queue", "max-size-buffers=0", "max-size-time=0", "max-size-bytes=10485760",
		"!", "kvssink",
		fmt.Sprintf("stream-name=%s", f.streamName),
		fmt.Sprintf("aws-region=%s", f.awsRegion),
		fmt.Sprintf("retention-period=%s", retentionPeriod),
		fmt.Sprintf("fragment-duration=%s", fragmentDuration),
		fmt.Sprintf("storage-size=%s", storageSize),
		"key-frame-fragmentation=true",
		"streaming-type=0",
	)

	// Set up environment for AWS credentials
	f.cmd.Env = os.Environ()

	// Get stdin pipe
	var err error
	f.stdin, err = f.cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	// Redirect stdout/stderr to log
	f.cmd.Stdout = &logWriter{prefix: "[GStreamer] "}
	f.cmd.Stderr = &logWriter{prefix: "[GStreamer] "}

	// Start the command
	if err := f.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start GStreamer: %w", err)
	}

	f.running = true
	f.frameCount = 0
	f.lastLogTime = time.Now()

	log.Printf("[KVS] GStreamer pipeline started (PID: %d)", f.cmd.Process.Pid)

	// Monitor process in background and auto-restart on failure
	go func() {
		err := f.cmd.Wait()
		f.mutex.Lock()
		wasRunning := f.running
		f.running = false
		f.stdin = nil
		shouldRestart := !f.stopped && wasRunning
		f.mutex.Unlock()
		
		if err != nil {
			log.Printf("[KVS] ⚠️  GStreamer pipeline exited with error: %v", err)
		} else {
			log.Printf("[KVS] GStreamer pipeline exited normally")
		}
		
		// Auto-restart if not explicitly stopped
		if shouldRestart {
			log.Printf("[KVS] 🔄 Will auto-restart pipeline on next frame...")
		}
	}()

	return nil
}

// restart restarts the GStreamer pipeline with fresh credentials.
// Must be called WITHOUT holding the mutex.
func (f *Forwarder) restart() error {
	f.mutex.Lock()
	if f.running {
		f.mutex.Unlock()
		return nil
	}
	
	// Rate limit restarts (max once per 5 seconds)
	if time.Since(f.lastRestartTime) < 5*time.Second {
		f.mutex.Unlock()
		return fmt.Errorf("restart rate limited")
	}
	f.lastRestartTime = time.Now()
	f.restartCount++
	f.mutex.Unlock()
	
	log.Printf("[KVS] 🔄 Auto-restarting pipeline (restart #%d)...", f.restartCount)
	
	// Force refresh credentials before restart
	if err := f.credManager.ForceRefresh(); err != nil {
		log.Printf("[KVS] ⚠️  Failed to refresh credentials during restart: %v", err)
	}
	
	return f.Start()
}

// WriteH264 writes H.264 NAL units to the KVS forwarder.
// Auto-restarts the pipeline if it has stopped unexpectedly.
func (f *Forwarder) WriteH264(pts, dts time.Duration, au [][]byte) {
	f.mutex.Lock()
	needsRestart := !f.running && !f.stopped
	f.mutex.Unlock()
	
	// Auto-restart if pipeline stopped unexpectedly
	if needsRestart {
		if err := f.restart(); err != nil {
			// Restart failed or rate limited, skip this frame
			return
		}
	}
	
	f.mutex.Lock()
	defer f.mutex.Unlock()

	if !f.running || f.stdin == nil {
		// Still not running after restart attempt
		return
	}

	// Log first few frames for debugging
	if f.frameCount < 10 {
		totalSize := 0
		for i, nalu := range au {
			totalSize += len(nalu)
			if len(nalu) > 0 {
				nalType := nalu[0] & 0x1F
				log.Printf("[KVS] Frame %d NALU %d: type=%d, size=%d, first bytes: %02x %02x %02x %02x", 
					f.frameCount, i, nalType, len(nalu), 
					nalu[0], 
					func() byte { if len(nalu) > 1 { return nalu[1] } else { return 0 } }(),
					func() byte { if len(nalu) > 2 { return nalu[2] } else { return 0 } }(),
					func() byte { if len(nalu) > 3 { return nalu[3] } else { return 0 } }())
			}
		}
		log.Printf("[KVS] WriteH264 frame %d: %d NALUs, total size %d bytes", f.frameCount, len(au), totalSize)
	}

	// Write H.264 NAL units with Annex B start codes
	for _, nalu := range au {
		// Write start code (0x00 0x00 0x00 0x01)
		startCode := []byte{0x00, 0x00, 0x00, 0x01}
		if _, err := f.stdin.Write(startCode); err != nil {
			log.Printf("[KVS] Failed to write start code: %v", err)
			return
		}

		// Write NAL unit
		if _, err := f.stdin.Write(nalu); err != nil {
			log.Printf("[KVS] Failed to write NAL unit: %v", err)
			return
		}
	}

	// Update statistics
	f.frameCount++
	
	// Log statistics every 10 seconds
	if time.Since(f.lastLogTime) > 10*time.Second {
		log.Printf("[KVS] Frames forwarded: %d", f.frameCount)
		f.lastLogTime = time.Now()
	}
}

// Stop stops the KVS forwarder and disables auto-restart.
func (f *Forwarder) Stop() {
	f.mutex.Lock()
	f.stopped = true // Disable auto-restart
	
	if !f.running {
		f.mutex.Unlock()
		return
	}

	log.Printf("[KVS] Stopping GStreamer pipeline...")

	if f.stdin != nil {
		f.stdin.Close()
		f.stdin = nil
	}

	cmd := f.cmd
	f.running = false
	f.mutex.Unlock()

	if cmd != nil && cmd.Process != nil {
		cmd.Process.Signal(os.Interrupt)
		
		// Wait for graceful shutdown with timeout
		done := make(chan struct{})
		go func() {
			cmd.Wait()
			close(done)
		}()

		select {
		case <-done:
			log.Printf("[KVS] GStreamer pipeline stopped gracefully")
		case <-time.After(5 * time.Second):
			log.Printf("[KVS] Force killing GStreamer pipeline")
			cmd.Process.Kill()
		}
	}
}

// Close closes the KVS forwarder.
func (f *Forwarder) Close() {
	f.Stop()
}

// logWriter is a simple io.Writer that logs each line with a prefix.
type logWriter struct {
	prefix string
}

func (w *logWriter) Write(p []byte) (n int, err error) {
	log.Printf("%s%s", w.prefix, string(p))
	return len(p), nil
}
