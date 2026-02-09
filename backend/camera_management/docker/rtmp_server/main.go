// RTMP/RTMPS Server with AWS KVS Forwarding
// This server receives RTMP/RTMPS streams and forwards H.264 video to AWS Kinesis Video Streams.
package main

import (
	"crypto/tls"
	"flag"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"rtmp_kvs/kvs"
	"rtmp_kvs/server"
)

func main() {
	// Command line flags
	rtmpAddr := flag.String("rtmp", ":1935", "RTMP listen address")
	rtmpsAddr := flag.String("rtmps", ":1936", "RTMPS listen address")
	certFile := flag.String("cert", "certs/server.crt", "TLS certificate file")
	keyFile := flag.String("key", "certs/server.key", "TLS private key file")
	enableRTMPS := flag.Bool("enable-rtmps", true, "Enable RTMPS listener")
	flag.Parse()

	// Environment variables for KVS
	streamName := os.Getenv("STREAM_NAME")
	if streamName == "" {
		log.Fatal("STREAM_NAME environment variable is required")
	}

	awsRegion := os.Getenv("AWS_REGION")
	if awsRegion == "" {
		log.Fatal("AWS_REGION environment variable is required")
	}

	// Create credential manager and start background refresh
	credManager := kvs.NewCredentialManager()
	
	// Initial credential refresh
	if err := credManager.RefreshCredentials(); err != nil {
		log.Printf("Warning: Initial credential refresh failed: %v", err)
	}
	
	// Start background credential refresh
	stopCredRefresh := make(chan struct{})
	credManager.StartBackgroundRefresh(stopCredRefresh)

	// Create KVS forwarder
	kvsForwarder := kvs.NewForwarder(streamName, awsRegion)

	// Create RTMP server
	rtmpServer := server.New(kvsForwarder)

	// Start RTMP listener
	rtmpLn, err := net.Listen("tcp", *rtmpAddr)
	if err != nil {
		log.Fatalf("Failed to start RTMP listener: %v", err)
	}
	log.Printf("RTMP server listening on %s", *rtmpAddr)
	go rtmpServer.Serve(rtmpLn, false)

	// Start RTMPS listener (if enabled and certificates exist)
	if *enableRTMPS {
		if _, err := os.Stat(*certFile); err == nil {
			cert, err := tls.LoadX509KeyPair(*certFile, *keyFile)
			if err != nil {
				log.Printf("Warning: Failed to load TLS certificates: %v", err)
				log.Printf("RTMPS disabled. Use generate-certs.sh to create certificates.")
			} else {
tlsConfig := &tls.Config{
				Certificates: []tls.Certificate{cert},
				MinVersion:   tls.VersionTLS13,
			}
				rtmpsLn, err := tls.Listen("tcp", *rtmpsAddr, tlsConfig)
				if err != nil {
					log.Fatalf("Failed to start RTMPS listener: %v", err)
				}
				log.Printf("RTMPS server listening on %s", *rtmpsAddr)
				go rtmpServer.Serve(rtmpsLn, true)
			}
		} else {
			log.Printf("Warning: TLS certificate not found at %s", *certFile)
			log.Printf("RTMPS disabled. Use generate-certs.sh to create certificates.")
		}
	}

	// Wait for interrupt signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	close(stopCredRefresh) // Stop background credential refresh
	rtmpLn.Close()
	kvsForwarder.Close()
}
