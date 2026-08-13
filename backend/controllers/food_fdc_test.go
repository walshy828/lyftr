package controllers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/models"
)

// withFDCMock points the FDC client and URLs at a local test server and enables
// the FDC leg by setting config.C.FDCAPIKey. Mirrors withOFFMock.
//
// Both the search and detail endpoints are retargeted at the same handler, so a
// test that cares about the label-hydration round trip can route on r.URL.Path
// ("/fdc/v1/foods/search" vs "/fdc/v1/foods").
func withFDCMock(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	s := httptest.NewServer(handler)

	prevClient, prevURL, prevDetail, prevCfg := fdcClient, fdcSearchURL, fdcDetailURL, config.C
	fdcClient = &http.Client{Timeout: 5 * time.Second}
	fdcSearchURL = s.URL + "/fdc/v1/foods/search"
	fdcDetailURL = s.URL + "/fdc/v1/foods"
	config.C = &config.Config{FDCAPIKey: "test-key"}

	t.Cleanup(func() {
		fdcClient, fdcSearchURL, fdcDetailURL, config.C = prevClient, prevURL, prevDetail, prevCfg
		s.Close()
	})
}

// fdcRoute dispatches a mocked FDC request to the search or detail responder.
func fdcRoute(search, detail http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/search") {
			search(w, r)
			return
		}
		detail(w, r)
	}
}

// ─── parseServingMass ─────────────────────────────────────────────────────────

func TestParseServingMass(t *testing.T) {
	cases := []struct {
		in          string
		wantGrams   float64
		wantMeasure string
	}{
		{"30 g (2 tbsp)", 30, "2 tbsp"},
		{"45g", 45, ""},
		{"1.5 oz", 42.5242846875, ""},
		{"1 cup", 0, ""},        // volume alone gives no mass
		{"250 ml", 0, ""},       // ml is volume, not mass — must not be read as grams
		{"", 0, ""},             // empty
		{"one serving", 0, ""},  // unparseable
		{"1 gallon", 0, ""},     // must not match "g" inside "gallon"
		{"28 g (28 g)", 28, ""}, // parenthetical restating the mass adds nothing
		{"0 g", 0, ""},          // zero is not a usable basis
	}

	for _, tc := range cases {
		grams, measure := parseServingMass(tc.in)
		if diff := grams - tc.wantGrams; diff > 0.0001 || diff < -0.0001 {
			t.Errorf("parseServingMass(%q) grams = %v, want %v", tc.in, grams, tc.wantGrams)
		}
		if measure != tc.wantMeasure {
			t.Errorf("parseServingMass(%q) measure = %q, want %q", tc.in, measure, tc.wantMeasure)
		}
	}
}

func TestNormalizeFoodName(t *testing.T) {
	if got := normalizeFoodName("  Whole   MILK\t"); got != "whole milk" {
		t.Errorf("normalizeFoodName = %q, want %q", got, "whole milk")
	}
}

// ─── offProductToResult gram basis ────────────────────────────────────────────

func TestOffProductToResult_per100gSetsGramBasis(t *testing.T) {
	p := offProduct{
		ProductName: "Mayonnaise",
		Nutriments:  offNutrients{EnergyKcal100g: 680, Fat100g: 75},
	}
	got := offProductToResult(p)

	if got.ServingSize != "per 100g" {
		t.Errorf("serving size = %q, want %q", got.ServingSize, "per 100g")
	}
	if got.ServingSizeGrams != 100 {
		t.Errorf("serving_size_grams = %v, want 100", got.ServingSizeGrams)
	}
}

func TestOffProductToResult_perServingParsesMassAndMeasure(t *testing.T) {
	p := offProduct{
		ProductName: "Mayonnaise",
		ServingSize: "14 g (1 tbsp)",
		Nutriments:  offNutrients{EnergyKcalServing: 94, FatServing: 10},
	}
	got := offProductToResult(p)

	if got.ServingSizeGrams != 14 {
		t.Errorf("serving_size_grams = %v, want 14", got.ServingSizeGrams)
	}
	if len(got.Portions) != 1 || got.Portions[0].Label != "1 tbsp" || got.Portions[0].Grams != 14 {
		t.Errorf("portions = %+v, want [{1 tbsp 14}]", got.Portions)
	}
}

func TestOffProductToResult_unparseableServingLeavesGramsUnknown(t *testing.T) {
	p := offProduct{
		ProductName: "Soup",
		ServingSize: "1 bowl",
		Nutriments:  offNutrients{EnergyKcalServing: 120},
	}
	got := offProductToResult(p)

	// A guessed gram basis would silently rescale every macro, so unknown must
	// stay unknown and let the client fall back to a plain multiplier.
	if got.ServingSizeGrams != 0 {
		t.Errorf("serving_size_grams = %v, want 0 for an unparseable label", got.ServingSizeGrams)
	}
}

// ─── fdcFoodToResult ──────────────────────────────────────────────────────────

func TestFdcFoodToResult_mapsPer100gAndPortions(t *testing.T) {
	f := fdcFood{
		Description: "Mayonnaise, regular",
		DataType:    "SR Legacy",
		FoodNutrients: []fdcNutrient{
			{NutrientID: fdcNutrientCalories, Value: 680},
			{NutrientID: fdcNutrientProtein, Value: 1},
			{NutrientID: fdcNutrientCarbs, Value: 0.6},
			{NutrientID: fdcNutrientFat, Value: 75},
			{NutrientID: fdcNutrientFiber, Value: 0},
			{NutrientID: fdcNutrientSugar, Value: 0.6},
			{NutrientID: fdcNutrientSodium, Value: 635},
			{NutrientID: fdcNutrientCholesterol, Value: 42},
		},
		FoodMeasures: []fdcFoodMeasure{
			{DisseminationText: "1 tbsp", GramWeight: 13.8},
			{DisseminationText: "1 cup", GramWeight: 220},
			{DisseminationText: "1 tbsp", GramWeight: 13.8}, // duplicate, must collapse
		},
	}
	got := fdcFoodToResult(f)

	if got.Source != "fdc" {
		t.Errorf("source = %q, want fdc", got.Source)
	}
	if got.ServingSizeGrams != 100 || got.ServingSize != "per 100g" {
		t.Errorf("basis = %v/%q, want 100/per 100g", got.ServingSizeGrams, got.ServingSize)
	}
	// FDC already reports sodium/cholesterol in mg — unlike OFF, no conversion.
	if got.Sodium != 635 || got.Cholesterol != 42 {
		t.Errorf("sodium/cholesterol = %v/%v, want 635/42", got.Sodium, got.Cholesterol)
	}
	if len(got.Portions) != 2 {
		t.Fatalf("portions = %+v, want 2 (duplicate collapsed)", got.Portions)
	}
	if got.Portions[0].Label != "1 tbsp" || got.Portions[0].Grams != 13.8 {
		t.Errorf("portions[0] = %+v, want {1 tbsp 13.8}", got.Portions[0])
	}
}

func TestFdcFoodToResult_brandedServingBecomesPortion(t *testing.T) {
	f := fdcFood{
		Description:              "Mayonnaise",
		DataType:                 "Branded",
		BrandName:                "Hellmann's",
		ServingSize:              14,
		ServingSizeUnit:          "g",
		HouseholdServingFullText: "1 Tbsp",
	}
	got := fdcFoodToResult(f)

	if got.Brand != "Hellmann's" {
		t.Errorf("brand = %q", got.Brand)
	}
	if len(got.Portions) != 1 || got.Portions[0].Label != "1 Tbsp" || got.Portions[0].Grams != 14 {
		t.Errorf("portions = %+v, want [{1 Tbsp 14}]", got.Portions)
	}
}

// TestFdcFoodToResult_servingUnitGRM is a regression test. FDC serves the
// UN/CEFACT code "GRM" as often as it serves "g", and the original equality
// check on "g" silently dropped the declared serving of every branded food
// that used it — leaving the user with no portion at all for exactly the
// products a barcode scan returns.
func TestFdcFoodToResult_servingUnitGRM(t *testing.T) {
	f := fdcFood{
		Description:              "Cheerios Cereal",
		DataType:                 "Branded",
		BrandName:                "Cheerios",
		ServingSize:              20,
		ServingSizeUnit:          "GRM",
		HouseholdServingFullText: "3/4 CUP",
	}
	got := fdcFoodToResult(f)

	if len(got.Portions) != 1 {
		t.Fatalf("portions = %+v, want 1 — GRM must be recognized as grams", got.Portions)
	}
	if got.Portions[0].Grams != 20 {
		t.Errorf("portion grams = %v, want 20", got.Portions[0].Grams)
	}
	if got.Portions[0].Label != "3/4 cup" {
		t.Errorf("portion label = %q, want %q (shouty FDC text tidied)", got.Portions[0].Label, "3/4 cup")
	}
}

func TestFdcFoodToResult_volumeServingGivesNoGramBasis(t *testing.T) {
	f := fdcFood{
		Description:     "Orange Juice",
		DataType:        "Branded",
		ServingSize:     240,
		ServingSizeUnit: "MLT", // millilitres — a volume, so no mass without a density
		LabelNutrients:  &fdcLabelNutrients{Calories: fdcLabelValue{Value: 110}},
	}
	got := fdcFoodToResult(f)

	if got.ServingSizeGrams != 0 {
		t.Errorf("serving_size_grams = %v, want 0 for a volume serving", got.ServingSizeGrams)
	}
	if len(got.Portions) != 0 {
		t.Errorf("portions = %+v, want none for a volume serving", got.Portions)
	}
	// The label numbers are still real, so they're still quoted — just without
	// a gram basis to rescale by.
	if !got.LabelAccurate || got.Calories != 110 {
		t.Errorf("label values should survive: accurate=%t calories=%v", got.LabelAccurate, got.Calories)
	}
}

func TestFdcFoodToResult_labelPanelBeatsPer100g(t *testing.T) {
	f := fdcFood{
		Description:              "Cheerios Cereal",
		DataType:                 "Branded",
		BrandName:                "Cheerios",
		GTINUpc:                  "00016000275287",
		PublicationDate:          "4/27/2023",
		ServingSize:              20,
		ServingSizeUnit:          "GRM",
		HouseholdServingFullText: "3/4 cup (20g)",
		// Per-100g values, which must NOT be what the user sees.
		FoodNutrients: []fdcNutrient{
			{NutrientID: fdcNutrientCalories, Value: 359},
			{NutrientID: fdcNutrientSodium, Value: 487},
		},
		LabelNutrients: &fdcLabelNutrients{
			Calories:      fdcLabelValue{Value: 71.8},
			Protein:       fdcLabelValue{Value: 2.56},
			Carbohydrates: fdcLabelValue{Value: 14.9},
			Fat:           fdcLabelValue{Value: 1.28},
			Fiber:         fdcLabelValue{Value: 2.06},
			Sugars:        fdcLabelValue{Value: 1.03},
			Sodium:        fdcLabelValue{Value: 97.4},
			Cholesterol:   fdcLabelValue{Value: 0},
		},
	}
	got := fdcFoodToResult(f)

	if got.Calories != 71.8 {
		t.Errorf("calories = %v, want the label's 71.8 (not the per-100g 359)", got.Calories)
	}
	// FDC label sodium is already mg — it must not be run through a conversion.
	if got.Sodium != 97.4 {
		t.Errorf("sodium = %v, want 97.4 mg", got.Sodium)
	}
	if !got.LabelAccurate {
		t.Error("label_accurate should be true when the panel was used")
	}
	if got.ServingSize != "3/4 cup (20g)" || got.ServingSizeGrams != 20 {
		t.Errorf("serving = %q/%v, want %q/20", got.ServingSize, got.ServingSizeGrams, "3/4 cup (20g)")
	}
	if got.Barcode != "00016000275287" || got.LabelDate != "4/27/2023" {
		t.Errorf("barcode/date = %q/%q", got.Barcode, got.LabelDate)
	}
}

func TestFdcFoodToResult_emptyLabelPanelFallsBackToPer100g(t *testing.T) {
	// FDC returns a labelNutrients object with no calories for some records.
	// Quoting that as "the label" would show the user a zero-calorie food.
	f := fdcFood{
		Description:    "Something Branded",
		DataType:       "Branded",
		LabelNutrients: &fdcLabelNutrients{},
		FoodNutrients:  []fdcNutrient{{NutrientID: fdcNutrientCalories, Value: 250}},
	}
	got := fdcFoodToResult(f)

	if got.LabelAccurate {
		t.Error("an empty label panel must not be marked label_accurate")
	}
	if got.Calories != 250 || got.ServingSize != "per 100g" {
		t.Errorf("expected per-100g fallback, got %v/%q", got.Calories, got.ServingSize)
	}
}

func TestTidyHouseholdServing(t *testing.T) {
	cases := []struct{ in, want string }{
		{"5.3 ONZ", "5.3 oz"},
		{"1 CONTAINER", "1 container"},
		{"3/4 cup (20g)", "3/4 cup (20g)"}, // already readable, left alone
		{"2 Tbsp", "2 Tbsp"},               // mixed case is already fine
		{"1 GRM", "1 g"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := tidyHouseholdServing(tc.in); got != tc.want {
			t.Errorf("tidyHouseholdServing(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestUsableServingLabel(t *testing.T) {
	cases := []struct {
		household string
		grams     float64
		want      string
	}{
		{"3/4 cup (20g)", 20, "3/4 cup (20g)"},
		{"1 pouch (31g)", 31, "1 pouch (31g)"},
		{"3/4 cup with 1/2 cup skim milk", 150, "3/4 cup with 1/2 cup skim milk"},
		// Manufacturer put the product name in the serving field. "1 ×
		// Frosted Cheerios" describes no quantity a user can reason about.
		{"Frosted Cheerios", 36, "36 g"},
		// A quantity with the unit dropped.
		{"36", 36, "36 g"},
		{"", 36, "36 g"},
		// With no gram weight there is nothing better to fall back to, so even
		// a poor label beats none.
		{"Frosted Cheerios", 0, "Frosted Cheerios"},
		{"", 0, ""},
	}
	for _, tc := range cases {
		if got := usableServingLabel(tc.household, tc.grams); got != tc.want {
			t.Errorf("usableServingLabel(%q, %v) = %q, want %q", tc.household, tc.grams, got, tc.want)
		}
	}
}

func TestNormalizeGTIN(t *testing.T) {
	cases := []struct{ in, want string }{
		{"016000275287", "00016000275287"},   // UPC-A, 12 digits
		{"0016000275287", "00016000275287"},  // EAN-13
		{"00016000275287", "00016000275287"}, // already a GTIN-14
		{"12345678", "00000012345678"},
	}
	for _, tc := range cases {
		if got := normalizeGTIN(tc.in); got != tc.want {
			t.Errorf("normalizeGTIN(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestFdcServingGrams(t *testing.T) {
	cases := []struct {
		size float64
		unit string
		want float64
	}{
		{20, "g", 20},
		{20, "GRM", 20},
		{1, "ONZ", 28.349523125},
		{240, "MLT", 0}, // volume: no mass without a density
		{240, "ml", 0},
		{0, "g", 0},
		{20, "widgets", 0},
	}
	for _, tc := range cases {
		got := fdcServingGrams(tc.size, tc.unit)
		if diff := got - tc.want; diff > 0.0001 || diff < -0.0001 {
			t.Errorf("fdcServingGrams(%v, %q) = %v, want %v", tc.size, tc.unit, got, tc.want)
		}
	}
}

func TestFdcStatusError_surfacesDataGovErrorCode(t *testing.T) {
	// The whole point: a 403 from a quoted or newline-terminated key is
	// indistinguishable from a revoked one unless the body is reported.
	body := []byte(`{"error":{"code":"API_KEY_INVALID","message":"An invalid api_key was supplied."}}`)
	got := fdcStatusError(403, body).Error()

	if !strings.Contains(got, "API_KEY_INVALID") {
		t.Errorf("error = %q, want it to name the data.gov code", got)
	}
	if !strings.Contains(got, "403") {
		t.Errorf("error = %q, want it to keep the status", got)
	}
}

func TestFdcStatusError_fallsBackWhenBodyIsNotDataGov(t *testing.T) {
	for _, body := range [][]byte{[]byte(`<html>502</html>`), nil, []byte(`{}`)} {
		got := fdcStatusError(502, body).Error()
		if !strings.Contains(got, "502") {
			t.Errorf("error = %q, want the status preserved for body %q", got, body)
		}
	}
}

// ─── label hydration ──────────────────────────────────────────────────────────

// fdcSearchWithID is a search response for a Branded food, carrying the fdcId
// hydration needs and only per-100g nutrients.
const fdcSearchWithID = `{"foods":[{"fdcId":2517161,"description":"Cheerios Cereal","dataType":"Branded",
	"brandName":"Cheerios","foodNutrients":[{"nutrientId":1008,"value":359}]}]}`

// fdcDetailWithLabel is the matching detail response, which is the only place
// FDC exposes labelNutrients.
const fdcDetailWithLabel = `[{"fdcId":2517161,"description":"Cheerios Cereal","dataType":"Branded",
	"gtinUpc":"00016000275287","servingSize":20,"servingSizeUnit":"GRM",
	"householdServingFullText":"3/4 cup (20g)",
	"labelNutrients":{"calories":{"value":71.8},"protein":{"value":2.56},"sodium":{"value":97.4}}}]`

func TestSearchFood_hydratesBrandedLabels(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	detailCalls := 0
	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"hits":[]}`))
	})
	withFDCMock(t, fdcRoute(
		func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(fdcSearchWithID)) },
		func(w http.ResponseWriter, r *http.Request) {
			detailCalls++
			w.Write([]byte(fdcDetailWithLabel))
		},
	))

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=cheerios", nil)
	th.SearchFood(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if detailCalls != 1 {
		t.Errorf("detail endpoint called %d times, want exactly 1 batched call", detailCalls)
	}

	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 result, got %d: %s", len(data), w.Body.String())
	}
	item := data[0].(map[string]any)
	if item["calories"].(float64) != 71.8 {
		t.Errorf("calories = %v, want the hydrated label's 71.8", item["calories"])
	}
	if item["label_accurate"] != true {
		t.Errorf("label_accurate = %v, want true", item["label_accurate"])
	}
	if item["serving_size"] != "3/4 cup (20g)" {
		t.Errorf("serving_size = %v, want the label serving", item["serving_size"])
	}
}

func TestSearchFood_labelHydrationFailureFallsBackToPer100g(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"hits":[]}`))
	})
	withFDCMock(t, fdcRoute(
		func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(fdcSearchWithID)) },
		func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) },
	))

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=cheerios", nil)
	th.SearchFood(c)

	// Hydration is best-effort: a broken detail call degrades the numbers, it
	// must never fail the search the user is waiting on.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 despite hydration failure, got %d: %s", w.Code, w.Body.String())
	}
	item := decodeResponse(t, w)["data"].([]any)[0].(map[string]any)
	if item["calories"].(float64) != 359 {
		t.Errorf("calories = %v, want the per-100g fallback 359", item["calories"])
	}
	if item["label_accurate"] == true {
		t.Error("label_accurate must be false when hydration failed")
	}
}

func TestRankByQuery_labelAccurateWinsWithinSameNameBand(t *testing.T) {
	results := []models.FoodSearchResult{
		{Name: "Cheerios", Calories: 359},
		{Name: "Cheerios", Calories: 140, LabelAccurate: true},
	}
	got := rankByQuery("cheerios", results)

	if !got[0].LabelAccurate {
		t.Error("a label-accurate result should sort ahead of a per-100g one with the same name")
	}
}

func TestRankByQuery_nameRelevanceOutranksLabelAccuracy(t *testing.T) {
	results := []models.FoodSearchResult{
		{Name: "Chicken Nuggets", LabelAccurate: true},
		{Name: "Chicken Breast"},
	}
	got := rankByQuery("chicken breast", results)

	// Otherwise searching for a whole food answers with whatever branded
	// product happens to have the best-attested label.
	if got[0].Name != "Chicken Breast" {
		t.Errorf("got[0] = %q, want the name match to outrank label accuracy", got[0].Name)
	}
}

// ─── merged SearchFood ────────────────────────────────────────────────────────

const fdcMayoResponse = `{"foods":[{"description":"Mayonnaise, regular","dataType":"SR Legacy",
	"foodNutrients":[{"nutrientId":1008,"value":680},{"nutrientId":1004,"value":75}],
	"foodMeasures":[{"disseminationText":"1 tbsp","gramWeight":13.8}]}]}`

func TestSearchFood_mergesBothSources(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"hits":[{"product_name":"Mayonnaise","brands":"Hellmann's","nutriments":{"energy-kcal_100g":680}}]}`))
	})
	withFDCMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(fdcMayoResponse))
	})

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=mayonnaise", nil)
	th.SearchFood(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 2 {
		t.Fatalf("expected 2 merged results, got %d: %s", len(data), w.Body.String())
	}

	sources := map[string]bool{}
	for _, item := range data {
		sources[item.(map[string]any)["source"].(string)] = true
	}
	if !sources["off"] || !sources["fdc"] {
		t.Errorf("expected both sources represented, got %v", sources)
	}
}

func TestSearchFood_dropsOFFEntriesWithNoNutrition(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// Real shape of an OFF query: a stub record someone scanned but never
	// filled in, ranked above the complete one. Both dedupe to the same
	// name+brand, so if the stub survives it is the only thing the user sees —
	// and logging it silently adds 0 kcal to their day.
	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"hits":[
			{"product_name":"Cheerios","brands":"Cheerios","nutriments":{}},
			{"product_name":"Cheerios","brands":"Cheerios","serving_size":"39 g","nutriments":{"energy-kcal_serving":140,"proteins_serving":5}}
		]}`))
	})
	withFDCMock(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"foods":[]}`)) })

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=cheerios", nil)
	th.SearchFood(c)

	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 result, got %d: %s", len(data), w.Body.String())
	}
	if cal := data[0].(map[string]any)["calories"].(float64); cal != 140 {
		t.Errorf("calories = %v, want 140 — the empty stub should have been dropped", cal)
	}
}

func TestSearchFood_dedupesAcrossSources(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	// Same normalized name+brand from both sources — the user sees one food.
	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"hits":[{"product_name":"Whole  MILK","brands":"Organic Valley","nutriments":{"energy-kcal_100g":61}}]}`))
	})
	withFDCMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"foods":[{"description":"whole milk","brandName":"organic valley","foodNutrients":[{"nutrientId":1008,"value":61}]}]}`))
	})

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=milk", nil)
	th.SearchFood(c)

	data := decodeResponse(t, w)["data"].([]any)
	if len(data) != 1 {
		t.Fatalf("expected 1 deduped result, got %d: %s", len(data), w.Body.String())
	}
}

func TestSearchFood_succeedsWhenOneSourceFails(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	withFDCMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(fdcMayoResponse))
	})

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=mayonnaise", nil)
	th.SearchFood(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 when FDC still answered, got %d: %s", w.Code, w.Body.String())
	}
	if data := decodeResponse(t, w)["data"].([]any); len(data) != 1 {
		t.Fatalf("expected 1 FDC result, got %d", len(data))
	}
}

func TestSearchFood_failsWhenBothSourcesFail(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	withFDCMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=mayonnaise", nil)
	th.SearchFood(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when both sources fail, got %d", w.Code)
	}
}

func TestSearchFood_skipsFDCWithoutAPIKey(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)

	fdcCalled := false
	withOFFMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"hits":[{"product_name":"Mayonnaise","nutriments":{"energy-kcal_100g":680}}]}`))
	})
	withFDCMock(t, func(w http.ResponseWriter, r *http.Request) {
		fdcCalled = true
		w.Write([]byte(fdcMayoResponse))
	})
	config.C.FDCAPIKey = "" // withFDCMock restores the previous config on cleanup

	c, w := newContext(uid, http.MethodGet, "/api/v1/food/search?q=mayonnaise", nil)
	th.SearchFood(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if fdcCalled {
		t.Error("FDC was queried despite an empty FDC_API_KEY")
	}
	if data := decodeResponse(t, w)["data"].([]any); len(data) != 1 {
		t.Fatalf("expected 1 OFF-only result, got %d", len(data))
	}
}
