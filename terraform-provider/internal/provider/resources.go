package provider

import (
	"context"
	"errors"
	"github.com/hashicorp/terraform-plugin-sdk/v2/diag"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/schema"
	"github.com/hashicorp/terraform-plugin-sdk/v2/helper/validation"
	"net/url"
)

type bodyFunc func(*schema.ResourceData) map[string]any

func resource(path string, fields map[string]*schema.Schema, body bodyFunc, readFields map[string]string, updatable bool) *schema.Resource {
	r := &schema.Resource{Schema: fields, Importer: &schema.ResourceImporter{StateContext: schema.ImportStatePassthroughContext}}
	r.CreateContext = func(ctx context.Context, d *schema.ResourceData, m any) diag.Diagnostics {
		out, err := m.(*Client).Request(ctx, "POST", path, body(d))
		if err != nil {
			return diag.FromErr(err)
		}
		id, ok := out["id"].(string)
		if !ok || id == "" {
			return diag.Errorf("API response missing resource ID")
		}
		d.SetId(id)
		if token, ok := out["token"].(string); ok {
			if err := d.Set("token", token); err != nil {
				return diag.FromErr(err)
			}
		}
		return r.ReadContext(ctx, d, m)
	}
	r.ReadContext = func(ctx context.Context, d *schema.ResourceData, m any) diag.Diagnostics {
		out, err := m.(*Client).Request(ctx, "GET", path+"/"+url.PathEscape(d.Id()), nil)
		if err != nil {
			var apiErr *APIError
			if errors.As(err, &apiErr) && apiErr.Status == 404 {
				d.SetId("")
				return nil
			}
			return diag.FromErr(err)
		}
		for field, jsonKey := range readFields {
			if value, ok := out[jsonKey]; ok && value != nil {
				if err := d.Set(field, value); err != nil {
					return diag.FromErr(err)
				}
			}
		}
		return nil
	}
	if updatable {
		r.UpdateContext = func(ctx context.Context, d *schema.ResourceData, m any) diag.Diagnostics {
			_, err := m.(*Client).Request(ctx, "PUT", path+"/"+url.PathEscape(d.Id()), body(d))
			if err != nil {
				return diag.FromErr(err)
			}
			return r.ReadContext(ctx, d, m)
		}
	}
	r.DeleteContext = func(ctx context.Context, d *schema.ResourceData, m any) diag.Diagnostics {
		_, err := m.(*Client).Request(ctx, "DELETE", path+"/"+url.PathEscape(d.Id()), nil)
		if err != nil {
			var apiErr *APIError
			if !errors.As(err, &apiErr) || apiErr.Status != 404 {
				return diag.FromErr(err)
			}
		}
		d.SetId("")
		return nil
	}
	return r
}
func requiredString(force bool) *schema.Schema {
	return &schema.Schema{Type: schema.TypeString, Required: true, ForceNew: force, ValidateFunc: validation.StringIsNotEmpty}
}
func optionalSecret() *schema.Schema {
	return &schema.Schema{Type: schema.TypeString, Optional: true, Sensitive: true}
}
func setStrings(d *schema.ResourceData, key string) []string {
	items := d.Get(key).(*schema.Set).List()
	out := make([]string, len(items))
	for i, x := range items {
		out[i] = x.(string)
	}
	return out
}
func infrastructure() *schema.Resource {
	return resource("/infrastructure", map[string]*schema.Schema{
		"name": requiredString(false), "type": {Type: schema.TypeString, Required: true, ForceNew: true, ValidateFunc: validation.StringInSlice([]string{"proxmox", "kubernetes", "xcpng", "citrix", "vmware"}, false)}, "endpoint": requiredString(false), "username": {Type: schema.TypeString, Optional: true}, "password": optionalSecret(), "api_token": optionalSecret(), "token_id": {Type: schema.TypeString, Optional: true}, "ca_cert": {Type: schema.TypeString, Optional: true},
	}, func(d *schema.ResourceData) map[string]any {
		return map[string]any{"name": d.Get("name"), "type": d.Get("type"), "endpoint": d.Get("endpoint"), "credentials": map[string]any{"username": d.Get("username"), "password": d.Get("password"), "token": d.Get("api_token"), "tokenId": d.Get("token_id"), "caCert": d.Get("ca_cert")}}
	}, map[string]string{"name": "name", "type": "type", "endpoint": "endpoint"}, true)
}
func vm() *schema.Resource {
	return resource("/vms", map[string]*schema.Schema{
		"infrastructure_id": requiredString(true), "name": requiredString(true), "template_id": requiredString(true), "cpus": {Type: schema.TypeInt, Required: true, ForceNew: true, ValidateFunc: validation.IntBetween(1, 256)}, "memory_mb": {Type: schema.TypeInt, Required: true, ForceNew: true, ValidateFunc: validation.IntAtLeast(128)}, "disk_gb": {Type: schema.TypeInt, Required: true, ForceNew: true, ValidateFunc: validation.IntAtLeast(1)},
	}, func(d *schema.ResourceData) map[string]any {
		return map[string]any{"infrastructure_id": d.Get("infrastructure_id"), "name": d.Get("name"), "template_id": d.Get("template_id"), "cpus": d.Get("cpus"), "memory_mb": d.Get("memory_mb"), "disk_gb": d.Get("disk_gb")}
	}, map[string]string{"name": "name", "infrastructure_id": "infrastructure_id", "cpus": "cpus", "memory_mb": "memory_mb"}, false)
}
func webhook() *schema.Resource {
	return resource("/webhooks", map[string]*schema.Schema{
		"name": requiredString(false), "url": requiredString(false), "events": {Type: schema.TypeSet, Required: true, MinItems: 1, Elem: &schema.Schema{Type: schema.TypeString}}, "secret": optionalSecret(), "active": {Type: schema.TypeBool, Optional: true, Default: true},
	}, func(d *schema.ResourceData) map[string]any {
		b := map[string]any{"name": d.Get("name"), "url": d.Get("url"), "events": setStrings(d, "events"), "active": d.Get("active")}
		if s := d.Get("secret").(string); s != "" {
			b["secret"] = s
		}
		return b
	}, map[string]string{"name": "name", "url": "url", "events": "events", "active": "active"}, true)
}
func user() *schema.Resource {
	fields := map[string]*schema.Schema{"email": requiredString(true), "password": {Type: schema.TypeString, Required: true, Sensitive: true, ValidateFunc: validation.StringLenBetween(16, 1024)}, "role": {Type: schema.TypeString, Required: true, ValidateFunc: validation.StringInSlice([]string{"admin", "user", "readonly"}, false)}, "active": {Type: schema.TypeBool, Optional: true, Default: true}}
	r := resource("/users", fields, func(d *schema.ResourceData) map[string]any {
		return map[string]any{"email": d.Get("email"), "password": d.Get("password"), "role": d.Get("role"), "active": d.Get("active")}
	}, map[string]string{"email": "email", "role": "role", "active": "active"}, true)
	r.UpdateContext = func(ctx context.Context, d *schema.ResourceData, m any) diag.Diagnostics {
		b := map[string]any{"role": d.Get("role"), "active": d.Get("active")}
		if d.HasChange("password") {
			b["password"] = d.Get("password")
		}
		_, err := m.(*Client).Request(ctx, "PUT", "/users/"+url.PathEscape(d.Id()), b)
		if err != nil {
			return diag.FromErr(err)
		}
		return r.ReadContext(ctx, d, m)
	}
	return r
}
func token() *schema.Resource {
	return resource("/tokens", map[string]*schema.Schema{
		"name": requiredString(true), "scopes": {Type: schema.TypeSet, Required: true, ForceNew: true, MinItems: 1, Elem: &schema.Schema{Type: schema.TypeString}}, "expires_at": {Type: schema.TypeString, Optional: true, ForceNew: true}, "token": {Type: schema.TypeString, Computed: true, Sensitive: true},
	}, func(d *schema.ResourceData) map[string]any {
		b := map[string]any{"name": d.Get("name"), "scopes": setStrings(d, "scopes")}
		if v := d.Get("expires_at").(string); v != "" {
			b["expiresAt"] = v
		}
		return b
	}, map[string]string{"name": "name", "scopes": "scopes", "expires_at": "expires_at"}, false)
}
