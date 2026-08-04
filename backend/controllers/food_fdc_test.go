package controllers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
)

// withFDCMock points the FDC client and URL at a local test server and enables
// the FDC leg by setting config.C.FDCAPIKey. Mirrors withOFFMock.
func withFDCMock(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	s := httptest.NewServer(handler)

	prevClient, prevURL, prevCfg := fdcClient, fdcSearchURL, config.C
	fdcClient = &http.Client{Timeout: 5 * time.Second}
	fdcSearchURL = s.URL + "/fdc/v1/foods/search"
	config.C = &config.Config{FDCAPIKey: "test-key"}

	t.Cleanup(func() {
		fdcClient, fdcSearchURL, config.C = prevClient, prevURL, prevCfg
		s.Close()
	})
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
