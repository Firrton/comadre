import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from "@aws-sdk/client-kms";
import { aesGcmEncrypt, aesGcmDecrypt, zeroize } from "./aesGcm.js";
import { ENCRYPTION_VERSION, loadWalletInfraEnv } from "../config.js";
import type { SessionKeyCiphertext, SessionKeyPlaintext } from "../types.js";

let _kms: KMSClient | null = null;

function getKmsClient(): KMSClient {
  if (_kms !== null) return _kms;
  const env = loadWalletInfraEnv();
  _kms = new KMSClient({ region: env.AWS_REGION });
  return _kms;
}

/**
 * Envelope encryption: KMS hands us a fresh 256-bit DEK; we AES-GCM-encrypt the
 * payload with it locally, then immediately zeroize the plaintext DEK from memory.
 * Only the KMS-wrapped form of the DEK persists.
 *
 * Rationale: avoid per-encryption KMS calls (cost + latency), keep CloudTrail noise
 * to decrypt operations only, and let the same KMS key serve any number of users.
 */
export async function encryptSessionKey(
  plaintext: SessionKeyPlaintext,
): Promise<SessionKeyCiphertext> {
  const env = loadWalletInfraEnv();
  const kms = getKmsClient();

  const dataKey = await kms.send(
    new GenerateDataKeyCommand({ KeyId: env.KMS_KEY_ARN, KeySpec: "AES_256" }),
  );

  if (!dataKey.Plaintext || !dataKey.CiphertextBlob) {
    throw new Error("[wallet-infra/kms] GenerateDataKey returned empty response");
  }

  const dek = Buffer.from(dataKey.Plaintext);
  try {
    const { ciphertext, iv } = aesGcmEncrypt(
      JSON.stringify({ blob: plaintext.blob, sessionPrivateKey: plaintext.sessionPrivateKey }),
      dek,
    );
    return {
      ciphertext,
      dekCiphertext: Buffer.from(dataKey.CiphertextBlob).toString("base64"),
      iv,
      encryptionVersion: ENCRYPTION_VERSION,
    };
  } finally {
    zeroize(dek);
  }
}

export async function decryptSessionKey(
  envelope: SessionKeyCiphertext,
): Promise<SessionKeyPlaintext> {
  if (envelope.encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error(
      `[wallet-infra/kms] unsupported encryption version "${envelope.encryptionVersion}"; ` +
        `expected "${ENCRYPTION_VERSION}". Migration required.`,
    );
  }
  const env = loadWalletInfraEnv();
  const kms = getKmsClient();

  const decrypted = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(envelope.dekCiphertext, "base64"),
      KeyId: env.KMS_KEY_ARN,
    }),
  );

  if (!decrypted.Plaintext) {
    throw new Error("[wallet-infra/kms] Decrypt returned empty Plaintext");
  }

  const dek = Buffer.from(decrypted.Plaintext);
  try {
    const plaintextBytes = aesGcmDecrypt({ ciphertext: envelope.ciphertext, iv: envelope.iv }, dek);
    const parsed = JSON.parse(plaintextBytes.toString("utf8")) as SessionKeyPlaintext;
    if (!parsed.blob || !parsed.sessionPrivateKey) {
      throw new Error("[wallet-infra/kms] decrypted payload missing required fields");
    }
    return parsed;
  } finally {
    zeroize(dek);
  }
}
