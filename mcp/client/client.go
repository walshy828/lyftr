// Package client is a thin HTTP client for the Lyftr REST API, authenticating
// with a personal access token. Kept decoupled from the backend module
// (small duplicated request/response shapes instead of importing
// backend/models) since this is an independently built and distributed binary.
package client

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
	baseURL string // e.g. http://localhost:3000/api/v1, no trailing slash
	token   string
	http    *http.Client
}

func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// apiError is returned when the backend responds with {"error": "..."}.
type apiError struct {
	status int
	msg    string
}

func (e *apiError) Error() string { return fmt.Sprintf("lyftr api: %s (status %d)", e.msg, e.status) }

func (c *Client) Get(ctx context.Context, path string, query url.Values) (json.RawMessage, error) {
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	return c.do(ctx, http.MethodGet, u, nil)
}

func (c *Client) Post(ctx context.Context, path string, body any) (json.RawMessage, error) {
	return c.doWithBody(ctx, http.MethodPost, c.baseURL+path, body)
}

func (c *Client) Put(ctx context.Context, path string, body any) (json.RawMessage, error) {
	return c.doWithBody(ctx, http.MethodPut, c.baseURL+path, body)
}

func (c *Client) doWithBody(ctx context.Context, method, url string, body any) (json.RawMessage, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return c.do(ctx, method, url, bytes.NewReader(b))
}

func (c *Client) do(ctx context.Context, method, url string, body io.Reader) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("lyftr api: request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var envelope struct {
		Data  json.RawMessage `json:"data"`
		Error string          `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("lyftr api: unexpected response (status %d): %s", resp.StatusCode, raw)
	}
	if resp.StatusCode >= 400 {
		msg := envelope.Error
		if msg == "" {
			msg = string(raw)
		}
		return nil, &apiError{status: resp.StatusCode, msg: msg}
	}
	return envelope.Data, nil
}
