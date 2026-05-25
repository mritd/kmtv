package main

import "embed"

//go:embed web/dist/*
var frontendFS embed.FS
