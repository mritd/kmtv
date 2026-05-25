package version

import (
	"runtime"
	"strings"
	"testing"
)

func TestInfoIncludesAllBuildMetadata(t *testing.T) {
	oldVersion, oldCommit, oldBuildTime := Version, GitCommit, BuildTime
	t.Cleanup(func() {
		Version, GitCommit, BuildTime = oldVersion, oldCommit, oldBuildTime
	})

	Version = "v1.2.3"
	GitCommit = "abc1234"
	BuildTime = "2026-05-25T10:30:00Z"

	got := Info()

	wants := []string{
		"v1.2.3",
		"abc1234",
		"2026-05-25T10:30:00Z",
		runtime.Version(),
		runtime.GOOS + "/" + runtime.GOARCH,
	}
	for _, want := range wants {
		if !strings.Contains(got, want) {
			t.Errorf("Info() = %q, missing %q", got, want)
		}
	}
}

func TestInfoUsesDevDefaultsWithoutLdflags(t *testing.T) {
	if !strings.HasPrefix(Version, "v") {
		t.Errorf("default Version = %q, expected a v-prefixed dev default", Version)
	}
	if !strings.Contains(Info(), Version) {
		t.Errorf("Info() = %q, missing default Version %q", Info(), Version)
	}
}
