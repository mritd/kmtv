package main

import (
	_ "github.com/mritd/logrus"

	"github.com/mritd/kmtv/cmd"
)

func main() {
	cmd.FrontendFS = frontendFS
	cmd.Execute()
}
