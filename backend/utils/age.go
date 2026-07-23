package utils

import "time"

// AgeFromBirthDate computes whole-years age as of asOf from a "YYYY-MM-DD"
// birth date, accounting for whether the birthday has occurred yet this
// year. Returns 0, false if birthDate is empty or unparseable.
func AgeFromBirthDate(birthDate string, asOf time.Time) (int, bool) {
	if birthDate == "" {
		return 0, false
	}
	b, err := time.Parse("2006-01-02", birthDate)
	if err != nil {
		return 0, false
	}
	age := asOf.Year() - b.Year()
	// Subtract one if this year's birthday hasn't happened yet.
	if asOf.Month() < b.Month() || (asOf.Month() == b.Month() && asOf.Day() < b.Day()) {
		age--
	}
	if age < 0 {
		age = 0
	}
	return age, true
}
