// Package kvs implements AWS Kinesis Video Streams forwarding.
package kvs

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// ecsCredentials represents the JSON response from ECS Container Credentials endpoint.
type ecsCredentials struct {
	AccessKeyId     string    `json:"AccessKeyId"`
	SecretAccessKey string    `json:"SecretAccessKey"`
	Token           string    `json:"Token"`
	Expiration      time.Time `json:"Expiration"`
}

// CredentialManager manages AWS credentials refresh for ECS Fargate environment.
type CredentialManager struct {
	mutex           sync.RWMutex
	lastRefresh     time.Time
	refreshInterval time.Duration
	expiration      time.Time
}

// NewCredentialManager creates a new credential manager.
func NewCredentialManager() *CredentialManager {
	return &CredentialManager{
		// Refresh credentials every 5 hours (before 6-hour expiration)
		refreshInterval: 5 * time.Hour,
	}
}

// RefreshCredentials fetches fresh credentials from ECS Container Credentials endpoint
// and exports them as environment variables for KVS SDK to use.
func (cm *CredentialManager) RefreshCredentials() error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	// Check if running on ECS Fargate
	relativeURI := os.Getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
	if relativeURI == "" {
		log.Println("[Credentials] Not running on ECS Fargate, skipping credential refresh")
		return nil
	}

	// Check if refresh is needed
	if !cm.needsRefresh() {
		log.Printf("[Credentials] Credentials still valid until %s, skipping refresh", cm.expiration.Format(time.RFC3339))
		return nil
	}

	log.Println("[Credentials] Refreshing AWS credentials from ECS Container Credentials endpoint...")

	// Build endpoint URL
	endpoint := fmt.Sprintf("http://169.254.170.2%s", relativeURI)

	// Fetch credentials
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(endpoint)
	if err != nil {
		return fmt.Errorf("failed to fetch credentials: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("credentials endpoint returned status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response
	var creds ecsCredentials
	if err := json.NewDecoder(resp.Body).Decode(&creds); err != nil {
		return fmt.Errorf("failed to parse credentials response: %w", err)
	}

	// Validate credentials
	if creds.AccessKeyId == "" || creds.SecretAccessKey == "" || creds.Token == "" {
		return fmt.Errorf("incomplete credentials received from endpoint")
	}

	// Export as environment variables for KVS SDK
	os.Setenv("AWS_ACCESS_KEY_ID", creds.AccessKeyId)
	os.Setenv("AWS_SECRET_ACCESS_KEY", creds.SecretAccessKey)
	os.Setenv("AWS_SESSION_TOKEN", creds.Token)

	// Update state
	cm.lastRefresh = time.Now()
	cm.expiration = creds.Expiration

	log.Printf("[Credentials] ✅ AWS credentials refreshed successfully")
	log.Printf("[Credentials]    AccessKeyId: %s...", creds.AccessKeyId[:10])
	log.Printf("[Credentials]    Expiration: %s", creds.Expiration.Format(time.RFC3339))

	return nil
}

// needsRefresh checks if credentials need to be refreshed.
func (cm *CredentialManager) needsRefresh() bool {
	// First time or no expiration set
	if cm.lastRefresh.IsZero() || cm.expiration.IsZero() {
		return true
	}

	// Refresh if within 30 minutes of expiration
	if time.Until(cm.expiration) < 30*time.Minute {
		return true
	}

	// Refresh if last refresh was more than refreshInterval ago
	if time.Since(cm.lastRefresh) > cm.refreshInterval {
		return true
	}

	return false
}

// ForceRefresh forces a credential refresh regardless of timing.
func (cm *CredentialManager) ForceRefresh() error {
	cm.mutex.Lock()
	cm.lastRefresh = time.Time{} // Reset to force refresh
	cm.mutex.Unlock()

	return cm.RefreshCredentials()
}

// StartBackgroundRefresh starts a background goroutine that periodically refreshes credentials.
func (cm *CredentialManager) StartBackgroundRefresh(stopCh <-chan struct{}) {
	// Only start if running on ECS Fargate
	if os.Getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") == "" {
		log.Println("[Credentials] Background refresh not needed (not on ECS Fargate)")
		return
	}

	go func() {
		// Check every 30 minutes
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()

		log.Println("[Credentials] Background credential refresh started (checking every 30 minutes)")

		for {
			select {
			case <-ticker.C:
				if err := cm.RefreshCredentials(); err != nil {
					log.Printf("[Credentials] ⚠️  Background refresh failed: %v", err)
				}
			case <-stopCh:
				log.Println("[Credentials] Background credential refresh stopped")
				return
			}
		}
	}()
}
