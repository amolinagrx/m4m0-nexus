package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSchema(t *testing.T) {
	if err := New().InternalValidate(); err != nil {
		t.Fatal(err)
	}
}
func TestClientRejectsHTTP(t *testing.T) {
	if _, err := NewClient("http://example.com", "token"); err == nil {
		t.Fatal("HTTP accepted")
	}
}
func TestAuthenticationAndRead(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("missing auth")
		}
		if r.URL.Path != "/api/v1/infrastructure/id" {
			t.Error(r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"id","name":"test"}`))
	}))
	defer server.Close()
	client, _ := NewClient(server.URL, "secret")
	client.HTTP = server.Client()
	r, err := client.Request(context.Background(), "GET", "/infrastructure/id", nil)
	if err != nil || r["name"] != "test" {
		t.Fatalf("%v %v", r, err)
	}
}
func TestNoRedirectCredentialForwarding(t *testing.T) {
	var received bool
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received = true }))
	defer target.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	c, _ := NewClient(server.URL, "secret")
	c.HTTP.Transport = server.Client().Transport
	_, err := c.Request(context.Background(), "GET", "/test", nil)
	if err == nil || received {
		t.Fatal("followed redirect")
	}
}
