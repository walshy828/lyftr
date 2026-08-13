package controllers

import (
	"regexp"
	"strconv"
	"strings"
)

// Portion helpers shared by the Open Food Facts and USDA FoodData Central
// normalizers. Both need to answer the same question — "how many grams do
// these nutrition numbers describe?" — so the client can rescale a food to any
// amount the user actually ate instead of a 0.5-step serving multiplier.

// massToGrams holds the mass units we accept, and only mass units. Volume
// (ml, tsp, cup) is deliberately absent: converting it needs a density we
// don't have, and a guessed gram weight would silently corrupt every macro
// derived from it.
var massToGrams = map[string]float64{
	"g":     1,
	"gram":  1,
	"grams": 1,
	"mg":    0.001,
	"kg":    1000,
	"oz":    28.349523125,
	"lb":    453.59237,
	"lbs":   453.59237,
}

// servingMassRe matches a leading quantity + mass unit: "30 g", "45g",
// "1.5 oz". The unit must terminate on a word boundary so "1 gallon" doesn't
// read as 1 gram.
var servingMassRe = regexp.MustCompile(`(?i)^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-z]+)\b`)

// servingMeasureRe captures a parenthetical household measure — the "2 tbsp"
// in "30 g (2 tbsp)".
var servingMeasureRe = regexp.MustCompile(`\(([^)]+)\)`)

// parseServingMass reads an Open Food Facts serving_size label and returns the
// serving's mass in grams plus any household measure it spells out.
//
// It is deliberately conservative: anything it cannot read as a mass yields 0,
// which the client treats as "unknown" and falls back to a plain multiplier.
// A wrong gram basis is worse than no gram basis, because every macro shown
// afterwards is scaled by it.
func parseServingMass(s string) (grams float64, measure string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, ""
	}

	if m := servingMeasureRe.FindStringSubmatch(s); m != nil {
		candidate := strings.TrimSpace(m[1])
		// Only keep a parenthetical that is itself a measure, not a restatement
		// of the mass — "(30 g)" adds nothing the gram basis doesn't say.
		if g, _ := parseLeadingMass(candidate); g == 0 {
			measure = candidate
		}
	}

	grams, _ = parseLeadingMass(s)
	return grams, measure
}

// parseLeadingMass converts a leading "<number> <mass unit>" prefix to grams.
// Returns 0 when the string doesn't start with a recognized mass.
func parseLeadingMass(s string) (grams float64, ok bool) {
	m := servingMassRe.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	qty, err := strconv.ParseFloat(m[1], 64)
	if err != nil || qty <= 0 {
		return 0, false
	}
	factor, known := massToGrams[strings.ToLower(m[2])]
	if !known {
		return 0, false
	}
	return qty * factor, true
}

// fdcUnitAliases maps FoodData Central's unit vocabulary onto the plain unit
// tokens massToGrams and human labels use. FDC serves a mix of conventions —
// "g" on some records, the UN/CEFACT code "GRM" on others, "ONZ" for ounces —
// and treating "GRM" as unknown silently drops a branded food's declared
// serving, which is the one portion the user actually cares about.
var fdcUnitAliases = map[string]string{
	"grm": "g",
	"gr":  "g",
	"onz": "oz",
	"lbr": "lb",
	"mlt": "ml",
	"mc":  "ml",
	"ltr": "l",
}

// canonicalUnit lowercases a unit token and resolves any FDC alias for it.
func canonicalUnit(u string) string {
	u = strings.ToLower(strings.TrimSpace(u))
	if alias, ok := fdcUnitAliases[u]; ok {
		return alias
	}
	return u
}

// fdcServingGrams converts an FDC servingSize/servingSizeUnit pair to grams,
// returning 0 when the unit is a volume (ml, cup) or otherwise not a mass —
// converting those needs a density we don't have, and a guessed gram basis
// would corrupt every macro scaled by it.
func fdcServingGrams(size float64, unit string) float64 {
	if size <= 0 {
		return 0
	}
	factor, known := massToGrams[canonicalUnit(unit)]
	if !known {
		return 0
	}
	return size * factor
}

// householdWordRe matches the individual word tokens of a household serving
// label so tidyHouseholdServing can rewrite unit abbreviations in place.
var householdWordRe = regexp.MustCompile(`[A-Za-z]+`)

// tidyHouseholdServing makes FDC's householdServingFullText fit to display.
// FDC emits shouty, abbreviated text — "5.3 ONZ", "1 CONTAINER" — which is
// correct but reads badly next to an Open Food Facts "30 g (2 tbsp)".
//
// It only rewrites tokens it recognizes: an all-caps word becomes lowercase,
// and a known FDC unit alias becomes its plain form. Anything else passes
// through untouched, because a serving label is the user's only description of
// what they're eating and mangling it is worse than leaving it shouty.
func tidyHouseholdServing(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	return householdWordRe.ReplaceAllStringFunc(s, func(word string) string {
		if alias, ok := fdcUnitAliases[strings.ToLower(word)]; ok {
			return alias
		}
		// Leave mixed-case words alone: they're already readable, and may be a
		// proper noun ("Oreo") that lowercasing would damage.
		if word == strings.ToUpper(word) {
			return strings.ToLower(word)
		}
		return word
	})
}

// normalizeGTIN left-pads a scanned barcode to the 14-digit GTIN form FDC
// indexes products under. A UPC-A scans as 12 digits and an EAN-13 as 13, but
// FDC stores both zero-padded to 14 — searching the unpadded code returns
// nothing at all, so this padding is required, not cosmetic. It doubles as the
// cache key, which is why it also collapses the three encodings of the same
// physical product onto one row.
func normalizeGTIN(code string) string {
	code = strings.TrimSpace(code)
	if len(code) >= 14 {
		return code
	}
	return strings.Repeat("0", 14-len(code)) + code
}

// normalizeFoodName is the Go-side twin of the SQL foodNameKey normalizer in
// stores/food.go: lowercase, whitespace collapsed, trimmed. Keeping the two in
// step means a food deduped across search sources here matches the same food
// grouped in the Recent query.
func normalizeFoodName(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}
