package controllers

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Portion helpers shared by the Open Food Facts and USDA FoodData Central
// normalizers. Both need to answer the same question — "how many grams do
// these nutrition numbers describe?" — so the client can rescale a food to any
// amount the user actually ate instead of a 0.5-step serving multiplier.

// massToGrams holds the mass units we accept. Volume units live in
// volumeToML instead: the two dimensions are kept apart on purpose, because
// crossing between them needs a density, and the client decides whether it has
// one (exact) or has to assume one (estimated, and labelled as such).
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

// volumeToML holds the volume units we accept, in millilitres.
//
// The spoon/cup values are the FDA labelling conventions (1 tsp = 5 ml,
// 1 tbsp = 15 ml, 1 fl oz = 30 ml, 1 cup = 240 ml), not the US customary ones
// (4.93 / 14.79 / 29.57 / 236.6). Every Nutrition Facts panel in the country is
// printed against the rounded figures, so a serving stated as "1 cup (240 ml)"
// is self-consistent only under them.
var volumeToML = map[string]float64{
	"ml": 1, "milliliter": 1, "milliliters": 1, "millilitre": 1, "millilitres": 1,
	"cl": 10, "dl": 100,
	"l": 1000, "liter": 1000, "liters": 1000, "litre": 1000, "litres": 1000,
	"tsp": 5, "teaspoon": 5, "teaspoons": 5,
	"tbsp": 15, "tbs": 15, "tablespoon": 15, "tablespoons": 15,
	"floz": 30, "fl oz": 30, "fluid ounce": 30, "fluid ounces": 30,
	"cup": 240, "cups": 240,
	"pt": 473, "pint": 473, "pints": 473,
	"qt": 946, "quart": 946, "quarts": 946,
	"gal": 3785, "gallon": 3785, "gallons": 3785,
}

// servingMassRe matches a leading quantity + mass unit: "30 g", "45g",
// "1.5 oz". The unit must terminate on a word boundary so "1 gallon" doesn't
// read as 1 gram.
var servingMassRe = regexp.MustCompile(`(?i)^\s*([0-9]+(?:\.[0-9]+)?)\s*([a-z]+)\b`)

// servingVolumeRe is servingMassRe's twin, with two additions volume labels
// need: multi-word units ("2 fl oz", "1 fluid ounce") and the vulgar fractions
// household measures are written with ("1/2 cup").
var servingVolumeRe = regexp.MustCompile(`(?i)^\s*([0-9]+(?:\.[0-9]+)?(?:\s*/\s*[0-9]+)?)\s*(fl\.?\s*oz|fluid\s+ounces?|[a-z]+)\b`)

// fractionRe matches the "1/2" form parseQuantity has to divide out.
var fractionRe = regexp.MustCompile(`^([0-9]+(?:\.[0-9]+)?)\s*/\s*([0-9]+(?:\.[0-9]+)?)$`)

// parseQuantity reads the number in front of a unit, accepting both "0.5" and
// the "1/2" a household measure is far more likely to be written with.
func parseQuantity(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if m := fractionRe.FindStringSubmatch(s); m != nil {
		num, err1 := strconv.ParseFloat(m[1], 64)
		den, err2 := strconv.ParseFloat(m[2], 64)
		if err1 != nil || err2 != nil || den == 0 || num <= 0 {
			return 0, false
		}
		return num / den, true
	}
	qty, err := strconv.ParseFloat(s, 64)
	if err != nil || qty <= 0 {
		return 0, false
	}
	return qty, true
}

// parseLeadingVolume converts a leading "<number> <volume unit>" prefix to
// millilitres. Returns 0 when the string doesn't start with a recognized
// volume — including when it starts with a mass, which parseLeadingMass owns.
func parseLeadingVolume(s string) (ml float64, ok bool) {
	m := servingVolumeRe.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	qty, valid := parseQuantity(m[1])
	if !valid {
		return 0, false
	}
	factor, known := volumeToML[canonicalUnit(m[2])]
	if !known {
		return 0, false
	}
	return qty * factor, true
}

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

// parseServingSize is parseServingMass extended to the volume dimension: it
// reports whichever basis the label states, and both when it states both.
//
// A liquid's serving is usually written as a volume ("240 ml", "1 cup (240
// ml)") and has no mass anywhere on the panel. Reading only the mass left every
// such product with no basis at all, so the picker collapsed to a bare
// multiplier — which is the case this exists to fix. Volume converts to volume
// exactly, no density required.
func parseServingSize(s string) (grams, ml float64, measure string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, 0, ""
	}

	grams, _ = parseLeadingMass(s)
	ml, _ = parseLeadingVolume(s)

	if m := servingMeasureRe.FindStringSubmatch(s); m != nil {
		candidate := strings.TrimSpace(m[1])
		pGrams, _ := parseLeadingMass(candidate)
		pML, _ := parseLeadingVolume(candidate)
		switch {
		// "(30 g)" next to a "30 g" basis restates it and adds nothing.
		case pGrams > 0:
			if grams == 0 {
				grams = pGrams
			}
		case pML > 0:
			if ml == 0 {
				ml = pML
			}
			// "14 g (1 tbsp)" states both dimensions of one serving — which is
			// this food's density — *and* names the measure the user thinks in.
			// "1 cup (240 ml)", by contrast, is the same volume said twice, so
			// it names nothing the leading text didn't.
			if grams > 0 {
				measure = candidate
			}
		default:
			measure = candidate
		}
	}

	return grams, ml, measure
}

// fdcServingML converts an FDC servingSize/servingSizeUnit pair to millilitres,
// returning 0 when the unit is a mass. It is the volume twin of
// fdcServingGrams: exactly one of the two answers non-zero for a given record.
func fdcServingML(size float64, unit string) float64 {
	if size <= 0 {
		return 0
	}
	factor, known := volumeToML[canonicalUnit(unit)]
	if !known {
		return 0
	}
	return size * factor
}

// portionML reads the volume a household measure names — the 15 ml in
// "1 tbsp". Paired with the portion's published gram weight it gives the
// client a real density for this specific food, which is what lets a cup be
// offered as an exact unit instead of an estimated one.
func portionML(label string) float64 {
	ml, _ := parseLeadingVolume(label)
	return ml
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
// Punctuation and inner spacing are normalized too, so the several ways a label
// writes a fluid ounce — "fl oz", "fl. oz", "FL  OZ" — all reach the one key
// volumeToML stores it under.
func canonicalUnit(u string) string {
	u = strings.ToLower(strings.TrimSpace(u))
	u = strings.ReplaceAll(u, ".", "")
	u = strings.Join(strings.Fields(u), " ")
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

// servingMeasureWords are the nouns a household serving description is built
// from. A label naming none of them, and carrying no quantity either, isn't
// describing a portion at all.
var servingMeasureWords = map[string]bool{
	"cup": true, "cups": true, "tbsp": true, "tablespoon": true, "tablespoons": true,
	"tsp": true, "teaspoon": true, "teaspoons": true, "oz": true, "ounce": true,
	"ounces": true, "g": true, "gram": true, "grams": true, "ml": true, "l": true,
	"piece": true, "pieces": true, "slice": true, "slices": true, "container": true,
	"pouch": true, "packet": true, "package": true, "bar": true, "can": true,
	"bottle": true, "box": true, "bag": true, "serving": true, "servings": true,
	"scoop": true, "scoops": true, "stick": true, "sticks": true, "egg": true,
	"cookie": true, "cookies": true, "cracker": true, "crackers": true,
	"slider": true, "patty": true, "link": true, "links": true, "wrap": true,
	"bun": true, "roll": true, "muffin": true, "bagel": true, "tortilla": true,
	"each": true, "unit": true, "units": true, "fl": true,
}

var digitRe = regexp.MustCompile(`[0-9]`)

// usableServingLabel picks the label to show for a branded food's declared
// serving, falling back to the plain gram form when FDC's household text can't
// serve as one.
//
// Manufacturers submit that field by hand and a fair number get it wrong —
// "Frosted Cheerios" (the product name), or a bare "36" with the unit dropped.
// Passing those through gives the user a portion picker offering "1 ×
// Frosted Cheerios", which describes nothing and can't be reasoned about. The
// gram weight is always right, so it's the safe fallback.
func usableServingLabel(household string, grams float64) string {
	household = strings.TrimSpace(household)
	gramLabel := ""
	if grams > 0 {
		gramLabel = fmt.Sprintf("%g g", grams)
	}
	if household == "" {
		return gramLabel
	}

	hasDigit := digitRe.MatchString(household)
	hasMeasure := false
	for _, w := range householdWordRe.FindAllString(household, -1) {
		if servingMeasureWords[strings.ToLower(w)] {
			hasMeasure = true
			break
		}
	}

	switch {
	// "36" — a quantity with no unit. The gram form says the same thing, but
	// unambiguously.
	case hasDigit && !hasMeasure && gramLabel != "":
		return gramLabel
	// "Frosted Cheerios" — neither a quantity nor a measure, so not a serving.
	case !hasDigit && !hasMeasure && gramLabel != "":
		return gramLabel
	default:
		return household
	}
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
