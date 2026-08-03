import {
  cleanText,
  error,
  json,
  platformAudit,
  readJson,
  requirePlatform,
} from "../../../_shared.js";
import {
  CUSTOMER_DIRECTORY_PROVIDER,
  ensureCustomerDirectorySchema,
} from "../../../_customer-entra.js";

const ALLOWED_COUNTRIES = new Set([
  "United Kingdom",
  "England",
  "Scotland",
  "Wales",
  "Northern Ireland",
  "Ireland",
  "Portugal",
]);

async function ensureIdentityProfileSchema(env) {
  await ensureCustomerDirectorySchema(env);
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS customer_identity_profiles (
      customer_id TEXT PRIMARY KEY,
      preferred_name TEXT,
      telephone_number TEXT,
      address_line_1 TEXT,
      address_line_2 TEXT,
      town_city TEXT,
      county_region TEXT,
      postcode TEXT,
      country TEXT,
      email_service_updates INTEGER NOT NULL DEFAULT 1,
      email_marketing INTEGER NOT NULL DEFAULT 0,
      sms_service_updates INTEGER NOT NULL DEFAULT 0,
      profile_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_customer_identity_profiles_updated_at
    ON customer_identity_profiles(updated_at)
  `).run();
}

function normaliseBoolean(value, fallback = false) {
  if (value === true || value === 1 || value === "1" || value === "true") return 1;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  return fallback ? 1 : 0;
}

function cleanPostcode(value) {
  return cleanText(value, 16).toUpperCase();
}

function completeProfile(profile) {
  return Boolean(
    cleanText(profile?.preferred_name, 160)
    && cleanText(profile?.telephone_number, 40)
    && cleanText(profile?.address_line_1, 180)
    && cleanText(profile?.town_city, 120)
    && cleanText(profile?.postcode, 16)
    && cleanText(profile?.country, 80)
  );
}

async function findCustomer(env, input) {
  if (input.customerNumber) {
    return env.DB.prepare("SELECT * FROM customers WHERE customer_number=? LIMIT 1")
      .bind(input.customerNumber)
      .first();
  }

  if (!input.tenantId || !input.objectId) return null;
  return env.DB.prepare(`
    SELECT c.*
    FROM customer_directory_identities i
    JOIN customers c ON c.id=i.customer_id
    WHERE i.provider=? AND i.tenant_id=? AND i.object_id=?
    LIMIT 1
  `)
    .bind(CUSTOMER_DIRECTORY_PROVIDER, input.tenantId, input.objectId)
    .first();
}

async function readProfile(env, customer) {
  const profile = await env.DB.prepare(`
    SELECT preferred_name,telephone_number,address_line_1,address_line_2,town_city,
           county_region,postcode,country,email_service_updates,email_marketing,
           sms_service_updates,profile_completed_at,created_at,updated_at
    FROM customer_identity_profiles WHERE customer_id=? LIMIT 1
  `).bind(customer.id).first();

  const identities = await env.DB.prepare(`
    SELECT provider,tenant_id,object_id,display_name,given_name,surname,primary_email,
           account_enabled,directory_status,last_synced_at
    FROM customer_directory_identities
    WHERE customer_id=? ORDER BY last_synced_at DESC
  `).bind(customer.id).all();

  const services = await env.DB.prepare(`
    SELECT p.code,p.name,a.external_account_id,a.status,a.linked_at,a.last_synced_at
    FROM customer_platform_accounts a
    JOIN platforms p ON p.id=a.platform_id
    WHERE a.customer_id=?
    ORDER BY p.name
  `).bind(customer.id).all();

  return {
    customer: {
      id: customer.id,
      customerNumber: customer.customer_number,
      displayName: customer.display_name,
      verifiedEmail: customer.verified_email,
      accountStatus: customer.account_status,
      securityStatus: customer.security_status,
      firstRegisteredAt: customer.first_registered_at,
      lastActivityAt: customer.last_activity_at,
      updatedAt: customer.updated_at,
    },
    profile: {
      preferredName: profile?.preferred_name || "",
      telephoneNumber: profile?.telephone_number || "",
      addressLine1: profile?.address_line_1 || "",
      addressLine2: profile?.address_line_2 || "",
      townCity: profile?.town_city || "",
      countyRegion: profile?.county_region || "",
      postcode: profile?.postcode || "",
      country: profile?.country || "United Kingdom",
      emailServiceUpdates: profile ? Number(profile.email_service_updates) === 1 : true,
      emailMarketing: profile ? Number(profile.email_marketing) === 1 : false,
      smsServiceUpdates: profile ? Number(profile.sms_service_updates) === 1 : false,
      profileCompletedAt: profile?.profile_completed_at || null,
      createdAt: profile?.created_at || null,
      updatedAt: profile?.updated_at || null,
    },
    identities: identities.results || [],
    connectedServices: services.results || [],
  };
}

function identityInput(url) {
  return {
    tenantId: cleanText(url.searchParams.get("tenantId"), 100),
    objectId: cleanText(url.searchParams.get("objectId"), 100),
    customerNumber: cleanText(url.searchParams.get("customerNumber"), 20),
  };
}

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["customers:read"]);
  if (auth.response) return auth.response;

  try {
    await ensureIdentityProfileSchema(context.env);
    const input = identityInput(new URL(context.request.url));
    const customer = await findCustomer(context.env, input);
    if (!customer) return error("CUSTOMER_NOT_FOUND", "The central customer record could not be found.", 404);

    const result = await readProfile(context.env, customer);
    await platformAudit(context.env, auth.platform, "customer.identity_profile_view", "customer", customer.id, {
      label: "Connected dashboard viewed central identity profile",
      reference: customer.customer_number,
      customerId: customer.id,
      requestId: context.data.requestId,
    });
    return json(result);
  } catch (cause) {
    return error(
      cause.code || "IDENTITY_PROFILE_READ_FAILED",
      cause.message || "The customer identity profile could not be read.",
      cause.status || 500,
    );
  }
};

export const onRequestPut = async context => {
  const auth = await requirePlatform(context, ["customers:write"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 24_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureIdentityProfileSchema(context.env);
    const input = {
      tenantId: cleanText(body.tenantId, 100),
      objectId: cleanText(body.objectId, 100),
      customerNumber: cleanText(body.customerNumber, 20),
    };
    const customer = await findCustomer(context.env, input);
    if (!customer) return error("CUSTOMER_NOT_FOUND", "The central customer record could not be found.", 404);

    const profile = {
      preferredName: cleanText(body.profile?.preferredName, 160),
      telephoneNumber: cleanText(body.profile?.telephoneNumber, 40),
      addressLine1: cleanText(body.profile?.addressLine1, 180),
      addressLine2: cleanText(body.profile?.addressLine2, 180),
      townCity: cleanText(body.profile?.townCity, 120),
      countyRegion: cleanText(body.profile?.countyRegion, 120),
      postcode: cleanPostcode(body.profile?.postcode),
      country: cleanText(body.profile?.country, 80) || "United Kingdom",
      emailServiceUpdates: normaliseBoolean(body.profile?.emailServiceUpdates, true),
      emailMarketing: normaliseBoolean(body.profile?.emailMarketing, false),
      smsServiceUpdates: normaliseBoolean(body.profile?.smsServiceUpdates, false),
    };

    if (profile.preferredName.length > 0 && profile.preferredName.length < 2) {
      return error("INVALID_PREFERRED_NAME", "The preferred name must contain at least two characters.", 400);
    }
    if (profile.country && profile.country.length < 2) {
      return error("INVALID_COUNTRY", "The country is invalid.", 400);
    }
    if (profile.country && !ALLOWED_COUNTRIES.has(profile.country) && profile.country.length > 80) {
      return error("INVALID_COUNTRY", "The country is invalid.", 400);
    }

    const now = new Date().toISOString();
    const completedAt = completeProfile({
      preferred_name: profile.preferredName,
      telephone_number: profile.telephoneNumber,
      address_line_1: profile.addressLine1,
      town_city: profile.townCity,
      postcode: profile.postcode,
      country: profile.country,
    }) ? now : null;

    await context.env.DB.prepare(`
      INSERT INTO customer_identity_profiles (
        customer_id,preferred_name,telephone_number,address_line_1,address_line_2,town_city,
        county_region,postcode,country,email_service_updates,email_marketing,sms_service_updates,
        profile_completed_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(customer_id) DO UPDATE SET
        preferred_name=excluded.preferred_name,
        telephone_number=excluded.telephone_number,
        address_line_1=excluded.address_line_1,
        address_line_2=excluded.address_line_2,
        town_city=excluded.town_city,
        county_region=excluded.county_region,
        postcode=excluded.postcode,
        country=excluded.country,
        email_service_updates=excluded.email_service_updates,
        email_marketing=excluded.email_marketing,
        sms_service_updates=excluded.sms_service_updates,
        profile_completed_at=excluded.profile_completed_at,
        updated_at=excluded.updated_at
    `).bind(
      customer.id,
      profile.preferredName || null,
      profile.telephoneNumber || null,
      profile.addressLine1 || null,
      profile.addressLine2 || null,
      profile.townCity || null,
      profile.countyRegion || null,
      profile.postcode || null,
      profile.country || null,
      profile.emailServiceUpdates,
      profile.emailMarketing,
      profile.smsServiceUpdates,
      completedAt,
      now,
      now,
    ).run();

    if (profile.preferredName) {
      await context.env.DB.prepare("UPDATE customers SET display_name=?,last_activity_at=?,updated_at=? WHERE id=?")
        .bind(profile.preferredName, now, now, customer.id)
        .run();
    } else {
      await context.env.DB.prepare("UPDATE customers SET last_activity_at=?,updated_at=? WHERE id=?")
        .bind(now, now, customer.id)
        .run();
    }

    await platformAudit(context.env, auth.platform, "customer.identity_profile_update", "customer", customer.id, {
      label: "Customer updated central identity profile",
      reference: customer.customer_number,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: {
        completed: Boolean(completedAt),
        updatedFields: Object.keys(profile),
      },
    });

    const refreshed = await context.env.DB.prepare("SELECT * FROM customers WHERE id=? LIMIT 1")
      .bind(customer.id)
      .first();
    return json(await readProfile(context.env, refreshed));
  } catch (cause) {
    return error(
      cause.code || "IDENTITY_PROFILE_UPDATE_FAILED",
      cause.message || "The customer identity profile could not be updated.",
      cause.status || 500,
    );
  }
};
