package utils

import (
	"testing"
	"time"
)

func TestAgeFromBirthDate(t *testing.T) {
	asOf := time.Date(2026, 7, 23, 0, 0, 0, 0, time.UTC)

	if _, ok := AgeFromBirthDate("", asOf); ok {
		t.Fatalf("expected ok=false for empty birth date")
	}
	if _, ok := AgeFromBirthDate("not-a-date", asOf); ok {
		t.Fatalf("expected ok=false for unparseable birth date")
	}

	// Birthday already passed this year.
	if age, ok := AgeFromBirthDate("1979-03-10", asOf); !ok || age != 47 {
		t.Fatalf("got age=%d ok=%v, want 47 true", age, ok)
	}
	// Birthday hasn't happened yet this year.
	if age, ok := AgeFromBirthDate("1979-12-25", asOf); !ok || age != 46 {
		t.Fatalf("got age=%d ok=%v, want 46 true", age, ok)
	}
	// Birthday is today.
	if age, ok := AgeFromBirthDate("2000-07-23", asOf); !ok || age != 26 {
		t.Fatalf("got age=%d ok=%v, want 26 true", age, ok)
	}
}
