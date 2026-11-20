-- Serialize quota-sensitive inserts/activations per tenant, including concurrent requests.
CREATE FUNCTION enforce_tenant_resource_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum integer; used integer;
BEGIN
  PERFORM 1 FROM organizations WHERE id = NEW."organizationId" FOR UPDATE;
  IF TG_TABLE_NAME = 'branches' THEN
    IF NEW.status <> 'ACTIVE' THEN RETURN NEW; END IF;
    SELECT p."maxBranches" + COALESCE((SELECT SUM(a."grantedUnits") FROM subscription_addons a JOIN addon_packs k ON k.id=a."addonPackId" WHERE a."subscriptionId"=s.id AND a."isActive" AND (a."expiresAt" IS NULL OR a."expiresAt">now()) AND k."quotaTarget"='BRANCHES'),0)
      INTO maximum FROM subscriptions s JOIN plans p ON p.id=s."planId" WHERE s."organizationId"=NEW."organizationId";
    SELECT count(*) INTO used FROM branches WHERE "organizationId"=NEW."organizationId" AND status='ACTIVE' AND id<>NEW.id;
  ELSE
    SELECT p."maxInternalUsers" INTO maximum FROM subscriptions s JOIN plans p ON p.id=s."planId" WHERE s."organizationId"=NEW."organizationId";
    SELECT count(*) INTO used FROM organization_users WHERE "organizationId"=NEW."organizationId" AND "userId"<>NEW."userId";
  END IF;
  -- Only the initial branch/admin may be created before its subscription, in onboarding's transaction.
  IF used >= COALESCE(maximum,1) THEN RAISE EXCEPTION 'Tenant resource limit reached' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER branches_tenant_cap BEFORE INSERT OR UPDATE OF status ON branches FOR EACH ROW EXECUTE FUNCTION enforce_tenant_resource_cap();
CREATE TRIGGER users_tenant_cap BEFORE INSERT ON organization_users FOR EACH ROW EXECUTE FUNCTION enforce_tenant_resource_cap();
