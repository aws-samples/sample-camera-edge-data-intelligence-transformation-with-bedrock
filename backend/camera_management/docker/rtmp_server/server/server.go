// Package server implements RTMP/RTMPS server functionality.
package server

import (
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"github.com/bluenviron/gortmplib"
	"github.com/bluenviron/gortmplib/pkg/codecs"

	"rtmp_kvs/kvs"
)

// Server represents an RTMP/RTMPS server.
type Server struct {
	forwarder *kvs.Forwarder
	mutex     sync.Mutex
	publishers map[string]*gortmplib.ServerConn
}

// New creates a new RTMP server.
func New(forwarder *kvs.Forwarder) *Server {
	return &Server{
		forwarder:  forwarder,
		publishers: make(map[string]*gortmplib.ServerConn),
	}
}

// Serve starts accepting connections on the given listener.
func (s *Server) Serve(ln net.Listener, isTLS bool) {
	protocol := "RTMP"
	if isTLS {
		protocol = "RTMPS"
	}

	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("[%s] Accept error: %v", protocol, err)
			return
		}
		go s.handleConn(conn, isTLS)
	}
}

func (s *Server) handleConn(conn net.Conn, isTLS bool) {
	protocol := "RTMP"
	if isTLS {
		protocol = "RTMPS"
	}

	defer conn.Close()
	remoteAddr := conn.RemoteAddr().String()
	log.Printf("[%s] Connection opened from %s", protocol, remoteAddr)

	err := s.handleConnInner(conn, isTLS)
	if err != nil {
		log.Printf("[%s] Connection %s closed: %v", protocol, remoteAddr, err)
	} else {
		log.Printf("[%s] Connection %s closed", protocol, remoteAddr)
	}
}

func (s *Server) handleConnInner(conn net.Conn, isTLS bool) error {
	// Set initial read deadline for handshake (30 seconds for mobile clients)
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))

	// Initialize RTMP server connection
	sc := &gortmplib.ServerConn{
		RW: conn,
	}
	if err := sc.Initialize(); err != nil {
		return err
	}

	// Accept connection and determine publish/read mode
	if err := sc.Accept(); err != nil {
		return err
	}

	// Get stream path
	streamPath := sc.URL.Path
	log.Printf("Stream path: %s, Publish: %v", streamPath, sc.Publish)

	// Validate stream path against expected value
	expectedPath := os.Getenv("RTMP_STREAM_PATH")
	if expectedPath != "" {
		expectedFullPath := "/live/" + expectedPath
		if streamPath != expectedFullPath {
			log.Printf("Invalid stream path: expected %s, got %s", expectedFullPath, streamPath)
			return errors.New("unauthorized: invalid stream path")
		}
		log.Printf("Stream path validated successfully")
	}

	if sc.Publish {
		return s.handlePublisher(sc, conn, isTLS)
	}

	// Read mode not supported - this server only receives streams
	log.Printf("Read mode not supported, closing connection")
	return nil
}

func (s *Server) handlePublisher(sc *gortmplib.ServerConn, conn net.Conn, isTLS bool) error {
	protocol := "RTMP"
	if isTLS {
		protocol = "RTMPS"
	}

	// Set read deadline (30 seconds for mobile clients)
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))

	// Initialize reader
	reader := &gortmplib.Reader{
		Conn: sc,
	}
	if err := reader.Initialize(); err != nil {
		log.Printf("[%s] Failed to initialize reader: %v", protocol, err)
		return err
	}

	// Get stream path for logging
	streamPath := sc.URL.Path
	remoteAddr := conn.RemoteAddr().String()

	// Register publisher
	s.mutex.Lock()
	if _, exists := s.publishers[streamPath]; exists {
		s.mutex.Unlock()
		log.Printf("[%s] Stream %s already has a publisher", protocol, streamPath)
		return nil
	}
	s.publishers[streamPath] = sc
	s.mutex.Unlock()

	// Track if forwarder was started
	forwarderStarted := false

	defer func() {
		// Recover from panic (use 'rec' to avoid shadowing 'reader')
		if rec := recover(); rec != nil {
			log.Printf("[%s] Recovered from panic: %v", protocol, rec)
		}
		
		log.Printf("[%s] Cleaning up publisher from %s", protocol, remoteAddr)
		
		s.mutex.Lock()
		delete(s.publishers, streamPath)
		s.mutex.Unlock()
		
		if forwarderStarted {
			log.Printf("[%s] Stopping forwarder...", protocol)
			s.forwarder.Stop()
		}
	}()

	log.Printf("[%s] Publisher connected from %s to path %s", protocol, remoteAddr, streamPath)

	// Log tracks
	tracks := reader.Tracks()
	log.Printf("[%s] Number of tracks: %d", protocol, len(tracks))
	for i, track := range tracks {
		log.Printf("[%s] Track %d: %T", protocol, i, track.Codec)
	}

	// Set up H.264 callback for KVS forwarding using channel
	h264Found := false
	dataChan := make(chan [][]byte, 100) // Buffered channel for H.264 data
	stopChan := make(chan struct{})
	
	for _, track := range tracks {
		switch codec := track.Codec.(type) {
		case *codecs.H264:
			log.Printf("[%s] H.264 track detected (SPS: %d bytes, PPS: %d bytes)", 
				protocol, len(codec.SPS), len(codec.PPS))
			
			// Start KVS forwarder
			log.Printf("[%s] Starting KVS forwarder...", protocol)
			if err := s.forwarder.Start(); err != nil {
				log.Printf("[%s] Failed to start KVS forwarder: %v", protocol, err)
				return err
			}
			forwarderStarted = true
			h264Found = true
			log.Printf("[%s] KVS forwarder started successfully", protocol)

			// Start goroutine to process H.264 data from channel
			go func() {
				for {
					select {
					case au := <-dataChan:
						s.forwarder.WriteH264(0, 0, au)
					case <-stopChan:
						return
					}
				}
			}()

			// Capture track in closure
			currentTrack := track
			
			// Set up callback for H.264 data - just send to channel
			log.Printf("[%s] Setting up H.264 data callback...", protocol)
			reader.OnDataH264(currentTrack, func(pts time.Duration, dts time.Duration, au [][]byte) {
				// Non-blocking send to channel
				select {
				case dataChan <- au:
				default:
					// Channel full, drop frame
				}
			})
			log.Printf("[%s] H.264 data callback set up", protocol)

		case *codecs.MPEG4Audio:
			log.Printf("[%s] AAC audio track detected (not forwarded to KVS)", protocol)
			// Set up dummy callback for AAC to prevent gortmplib internal issues
			currentAudioTrack := track
			reader.OnDataMPEG4Audio(currentAudioTrack, func(pts time.Duration, au []byte) {
				// Discard audio data - not forwarding to KVS
			})
			log.Printf("[%s] AAC audio callback set up (data discarded)", protocol)
		
		default:
			log.Printf("[%s] Unknown track type: %T", protocol, track.Codec)
		}
	}
	
	// Ensure stopChan is closed when function exits
	defer func() {
		close(stopChan)
	}()

	if !h264Found {
		log.Printf("[%s] No H.264 track found, closing connection", protocol)
		return nil
	}

	log.Printf("[%s] Starting read loop for %s...", protocol, remoteAddr)

	// Read loop with error handling and panic recovery per iteration
	frameCount := 0
	for {
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		
		// Wrap Read() in a function with panic recovery
		err := func() (readErr error) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[%s] Panic in Read(): %v", protocol, r)
					readErr = fmt.Errorf("panic in Read: %v", r)
				}
			}()
			return reader.Read()
		}()
		
		if err != nil {
			log.Printf("[%s] Read error from %s after %d frames: %v", protocol, remoteAddr, frameCount, err)
			return err
		}
		frameCount++
		
		// Log progress every 100 frames
		if frameCount%100 == 0 {
			log.Printf("[%s] Processed %d frames from %s", protocol, frameCount, remoteAddr)
		}
	}
}
