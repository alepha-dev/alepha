/**
 * One ES256 registration and assertion captured from Chromium's virtual
 * authenticator (CDP `WebAuthn.addVirtualAuthenticator`: ctap2, internal
 * transport, resident key, user verification), served from
 * `http://localhost:64886` with the RP ID `localhost`. The JSON is the browser's own
 * `PublicKeyCredential.toJSON()`. Chromium counts: the assertion carries
 * a sign counter of 2 after a registration of 1.
 */
export const chromiumWebAuthnCapture = {
  origin: "http://localhost:64886",
  rpId: "localhost",
  registration: {
    challenge: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
    credential: {
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      id: "ML7bGApaZz5H-oJwJxCyEbGEyDRZKb43qh1xRir_ChQ",
      rawId: "ML7bGApaZz5H-oJwJxCyEbGEyDRZKb43qh1xRir_ChQ",
      response: {
        attestationObject:
          "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikSZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAQECAwQFBgcIAQIDBAUGBwgAIDC-2xgKWmc-R_qCcCcQshGxhMg0WSm-N6odcUYq_woUpQECAyYgASFYIIbzDYo8aVd5BnGdRbjuclL_DGqtkg7VFLUutrlEfeCBIlggiuHBcN0_W1tBTE77o5ats5EKVTwnwAOpX3raUrOxkDM",
        authenticatorData:
          "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2NFAAAAAQECAwQFBgcIAQIDBAUGBwgAIDC-2xgKWmc-R_qCcCcQshGxhMg0WSm-N6odcUYq_woUpQECAyYgASFYIIbzDYo8aVd5BnGdRbjuclL_DGqtkg7VFLUutrlEfeCBIlggiuHBcN0_W1tBTE77o5ats5EKVTwnwAOpX3raUrOxkDM",
        clientDataJSON:
          "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiQVFJREJBVUdCd2dKQ2dzTURRNFBFQkVTRXhRVkZoY1lHUm9iSEIwZUh5QSIsIm9yaWdpbiI6Imh0dHA6Ly9sb2NhbGhvc3Q6NjQ4ODYiLCJjcm9zc09yaWdpbiI6ZmFsc2V9",
        publicKey:
          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhvMNijxpV3kGcZ1FuO5yUv8Maq2SDtUUtS62uUR94IGK4cFw3T9bW0FMTvujlq2zkQpVPCfAA6lfetpSs7GQMw",
        publicKeyAlgorithm: -7,
        transports: ["internal"],
      },
      type: "public-key",
    },
  },
  authentication: {
    challenge: "ZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4CBgoM",
    credential: {
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      id: "ML7bGApaZz5H-oJwJxCyEbGEyDRZKb43qh1xRir_ChQ",
      rawId: "ML7bGApaZz5H-oJwJxCyEbGEyDRZKb43qh1xRir_ChQ",
      response: {
        authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MFAAAAAg",
        clientDataJSON:
          "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiWkdWbVoyaHBhbXRzYlc1dmNIRnljM1IxZG5kNGVYcDdmSDEtZjRDQmdvTSIsIm9yaWdpbiI6Imh0dHA6Ly9sb2NhbGhvc3Q6NjQ4ODYiLCJjcm9zc09yaWdpbiI6ZmFsc2V9",
        signature:
          "MEYCIQCv9-9P2bHdAbQ0-N5Kv_tde0rPhTPJXxHgVj2U5tFbCwIhAJm5j1gO6ANidoiD56JPJy-yGiepxwCL8FqzKsSlsNMI",
        userHandle: "AQIDBA",
      },
      type: "public-key",
    },
  },
};
