package config

import "testing"

// A malformed API key reaches the provider as a plain 403, which reads exactly
// like a revoked key — so the mistakes that corrupt one in transit are worth
// catching before the request goes out.
func TestGetSecret_stripsTranscriptionArtifacts(t *testing.T) {
	// Shaped like a data.gov key (40 alphanumeric chars) so the quote- and
	// whitespace-stripping cases exercise a realistic length. Never use a real
	// credential here: test fixtures are the easiest secret to leak, because
	// nobody reads them again after they go green.
	const key = "EXAMPLEKEYNOTAREALCREDENTIAL000000000000"

	cases := []struct {
		name string
		set  string
		want string
	}{
		{"clean", key, key},
		// docker-compose reads a .env file literally, unlike a shell, so the
		// quotes become part of the value.
		{"double quoted", `"` + key + `"`, key},
		{"single quoted", `'` + key + `'`, key},
		{"trailing newline", key + "\n", key},
		{"surrounding whitespace", "  " + key + " ", key},
		{"quoted with whitespace", ` "` + key + `" `, key},
		// An unmatched quote is not a transcription artifact we can safely
		// assume away — it might genuinely be part of the value.
		{"unmatched quote", `"` + key, `"` + key},
		{"empty", "", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TEST_SECRET", tc.set)
			if got := getSecret("TEST_SECRET", ""); got != tc.want {
				t.Errorf("getSecret() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestGetSecret_fallbackIsAlsoCleaned(t *testing.T) {
	t.Setenv("TEST_SECRET", "")
	if got := getSecret("TEST_SECRET", "  fallback\n"); got != "fallback" {
		t.Errorf("getSecret() = %q, want %q", got, "fallback")
	}
}
