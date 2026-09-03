package client

import (
	"encoding/json"
	"testing"
)

func TestWrapArray(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"array", `[{"id":1},{"id":2}]`, `{"items":[{"id":1},{"id":2}]}`},
		{"empty array", `[]`, `{"items":[]}`},
		{"leading whitespace array", "  \n[1,2]", `{"items":[1,2]}`},
		{"object passes through", `{"avg":223,"latest":218.5}`, `{"avg":223,"latest":218.5}`},
		{"null passes through", `null`, `null`},
		{"empty passes through", ``, ``},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := wrapArray(json.RawMessage(tc.in))
			if string(got) != tc.want {
				t.Errorf("wrapArray(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
