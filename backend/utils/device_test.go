package utils

import "testing"

func TestDeviceLabel(t *testing.T) {
	tests := []struct {
		name string
		ua   string
		want string
	}{
		{
			// The case the whole ordering exists for: Chrome's UA also contains
			// "Safari", so a naive check labels every Android phone "Safari".
			name: "chrome on android is not mistaken for safari",
			ua:   "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
			want: "Chrome on Android",
		},
		{
			name: "edge is not mistaken for chrome",
			ua:   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0",
			want: "Edge on Windows",
		},
		{
			name: "real safari on iphone",
			ua:   "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
			want: "Safari on iPhone",
		},
		{
			// iPadOS claims "Macintosh"; the iPad check must come first.
			name: "ipad claiming to be a mac",
			ua:   "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1",
			want: "Safari on iPad",
		},
		{
			name: "firefox on mac",
			ua:   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
			want: "Firefox on Mac",
		},
		{
			name: "platform only",
			ua:   "SomeScraper/1.0 (Linux)",
			want: "Linux",
		},
		{
			name: "browser only",
			ua:   "Firefox/121.0",
			want: "Firefox",
		},
		{
			// Says so rather than guessing — a wrong label is worse than none
			// when the point is deciding which device to revoke.
			name: "unrecognisable",
			ua:   "curl/8.4.0",
			want: "Unknown device",
		},
		{name: "empty", ua: "", want: "Unknown device"},
		{name: "whitespace only", ua: "   ", want: "Unknown device"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := DeviceLabel(tc.ua); got != tc.want {
				t.Errorf("DeviceLabel(%q) = %q, want %q", tc.ua, got, tc.want)
			}
		})
	}
}
