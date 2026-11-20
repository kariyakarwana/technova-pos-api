import { AddonQuotaTarget } from '@prisma/client';

export interface DefaultAddonPackDef {
  code: string;
  name: string;
  description: string;
  quotaTarget: AddonQuotaTarget;
  unitsPerPack: number;
  priceUsd: number;
  billingCycle: string;
  features: Array<{ key: string; label: string; enabled: boolean }>;
}

export const DEFAULT_ADDON_PACKS: DefaultAddonPackDef[] = [
  {
    code: 'WHATSAPP_BILLS_PACK',
    name: 'WhatsApp Digital Bills Pack',
    description: 'Instant digital e-receipt delivery via WhatsApp Business Cloud API.',
    quotaTarget: AddonQuotaTarget.WHATSAPP_BILLS,
    unitsPerPack: 1000,
    priceUsd: 10,
    billingCycle: 'ONE_TIME',
    features: [
      { key: 'whatsapp_digital_receipts', label: 'WhatsApp Digital E-Receipts', enabled: true },
    ],
  },
  {
    code: 'WHATSAPP_MARKETING_PACK',
    name: 'WhatsApp Marketing Broadcast Pack',
    description: 'Promotional campaign messages and customer re-engagement templates.',
    quotaTarget: AddonQuotaTarget.WHATSAPP_MARKETING,
    unitsPerPack: 100,
    priceUsd: 15,
    billingCycle: 'ONE_TIME',
    features: [
      { key: 'whatsapp_marketing_campaigns', label: 'WhatsApp Marketing Broadcasts', enabled: true },
    ],
  },
  {
    code: 'TRANSACTIONAL_EMAIL_PACK',
    name: 'Transactional Email Pack',
    description: 'High-deliverability invoice, OTP, and supplier purchase order emails.',
    quotaTarget: AddonQuotaTarget.EMAILS,
    unitsPerPack: 5000,
    priceUsd: 15,
    billingCycle: 'ONE_TIME',
    features: [
      { key: 'transactional_email_dispatch', label: 'Transactional Email Dispatch', enabled: true },
    ],
  },
  {
    code: 'GEMINI_AI_PACK',
    name: 'Gemini AI Intelligence Pack',
    description: 'Stock depletion forecasting, smart reordering, and natural-language analytics.',
    quotaTarget: AddonQuotaTarget.AI_REQUESTS,
    unitsPerPack: 500,
    priceUsd: 20,
    billingCycle: 'ONE_TIME',
    features: [
      { key: 'gemini_ai_assistant', label: 'Gemini AI Assistant & Forecasting', enabled: true },
    ],
  },
  {
    code: 'ADDITIONAL_BRANCH',
    name: 'Additional Branch Location',
    description: 'Provision an extra retail store location with independent POS terminals.',
    quotaTarget: AddonQuotaTarget.BRANCHES,
    unitsPerPack: 1,
    priceUsd: 20,
    billingCycle: 'MONTHLY',
    features: [
      { key: 'multi_branch_expansion', label: 'Additional Retail Branch Seat', enabled: true },
    ],
  },
];
