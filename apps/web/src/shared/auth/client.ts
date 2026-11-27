"use client";
import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
// oauthProviderClient forwards the signed OAuth query (oauth_query) found in the page URL with
// sign-in and consent requests, so signing in during an authorization continues that flow.
export const authClient = createAuthClient({ plugins: [jwtClient(), oauthProviderClient()] });
