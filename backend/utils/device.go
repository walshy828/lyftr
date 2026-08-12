package utils

import "strings"

// DeviceLabel turns a User-Agent into something a person can recognise on the
// account screen, e.g. "Safari on iPhone".
//
// Deliberately crude. A real UA-parsing library is a large dependency and a
// perpetual maintenance tail, and the stakes here are low: the label only has
// to help you tell your phone from your laptop before you revoke one. When it
// can't tell, it says so rather than guessing.
func DeviceLabel(ua string) string {
	if strings.TrimSpace(ua) == "" {
		return "Unknown device"
	}

	// Order matters throughout: the specific case must win over the generic
	// substring it contains. Every Chromium browser claims "Safari", Edge
	// claims "Chrome", and iPadOS claims "Macintosh".
	browser := ""
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/"), strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Chrome/"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}

	platform := ""
	switch {
	case strings.Contains(ua, "iPhone"):
		platform = "iPhone"
	case strings.Contains(ua, "iPad"):
		platform = "iPad"
	case strings.Contains(ua, "Android"):
		platform = "Android"
	case strings.Contains(ua, "Macintosh"), strings.Contains(ua, "Mac OS X"):
		platform = "Mac"
	case strings.Contains(ua, "Windows"):
		platform = "Windows"
	case strings.Contains(ua, "Linux"):
		platform = "Linux"
	}

	switch {
	case browser != "" && platform != "":
		return browser + " on " + platform
	case browser != "":
		return browser
	case platform != "":
		return platform
	default:
		return "Unknown device"
	}
}
