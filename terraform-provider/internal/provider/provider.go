package provider

import (
	"context"
	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
)

func New() *schema.Provider {
	p := &schema.Provider{Schema: map[string]*schema.Schema{
		"endpoint":  {Type: schema.TypeString, Required: true, DefaultFunc: schema.EnvDefaultFunc("NEXUS_ENDPOINT", nil)},
		"api_token": {Type: schema.TypeString, Required: true, Sensitive: true, DefaultFunc: schema.EnvDefaultFunc("NEXUS_API_TOKEN", nil)},
	}, ResourcesMap: map[string]*schema.Resource{
		"m4m0nexus_infrastructure": infrastructure(), "m4m0nexus_vm": vm(), "m4m0nexus_webhook": webhook(), "m4m0nexus_user": user(), "m4m0nexus_api_token": token()}}
	p.ConfigureContextFunc = func(ctx context.Context, d *schema.ResourceData) (any, diag.Diagnostics) {
		client, err := NewClient(d.Get("endpoint").(string), d.Get("api_token").(string))
		if err != nil {
			return nil, diag.FromErr(err)
		}
		return client, nil
	}
	return p
}
