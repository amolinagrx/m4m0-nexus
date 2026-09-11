package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	Endpoint string
	Token    string
	HTTP     *http.Client
}
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("NEXUS API (%d): %s", e.Status, e.Message) }
func NewClient(endpoint, token string) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return nil, fmt.Errorf("endpoint must be HTTPS without embedded credentials")
	}
	return &Client{Endpoint: strings.TrimRight(endpoint, "/"), Token: token, HTTP: &http.Client{Timeout: 180 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) Request(ctx context.Context, method, path string, body any) (map[string]any, error) {
	var data io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		data = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Endpoint+"/api/v1"+path, data)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	r, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	b, err := io.ReadAll(io.LimitReader(r.Body, 8*1024*1024))
	if err != nil {
		return nil, err
	}
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(b, &e)
		return nil, &APIError{Status: r.StatusCode, Message: e.Error}
	}
	var out map[string]any
	if len(b) > 0 {
		if err = json.Unmarshal(b, &out); err != nil {
			return nil, err
		}
	}
	return out, nil
}
