package main

import (
	"github.com/hashicorp/terraform-plugin-sdk/v2/plugin"
	"github.com/m4m0/terraform-provider-m4m0nexus/internal/provider"
)

func main() { plugin.Serve(&plugin.ServeOpts{ProviderFunc: provider.New}) }
