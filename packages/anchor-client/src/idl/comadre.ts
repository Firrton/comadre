/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/comadre.json`.
 */
export type Comadre = {
  "address": "BfVXncFhJdSsDciLx7UzVjFbEBw1EtcnJCsYSRis54Sh",
  "metadata": {
    "name": "comadre",
    "version": "0.0.1",
    "spec": "0.1.0",
    "description": "Comadre — tandas on-chain en Solana"
  },
  "instructions": [
    {
      "name": "completeTanda",
      "discriminator": [
        158,
        66,
        156,
        138,
        3,
        219,
        87,
        123
      ],
      "accounts": [
        {
          "name": "crank",
          "docs": [
            "Must equal program_config.crank_authority."
          ],
          "signer": true
        },
        {
          "name": "tanda",
          "writable": true
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "contribute",
      "discriminator": [
        82,
        33,
        68,
        131,
        32,
        0,
        205,
        95
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "tanda"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "tanda",
          "writable": true
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "userUsdcAta",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createTanda",
      "discriminator": [
        55,
        18,
        165,
        166,
        110,
        120,
        33,
        66
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "creatorProfile",
          "docs": [
            "Creator must have an initialised profile so we can check their KYC tier."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              }
            ]
          }
        },
        {
          "name": "programConfig",
          "docs": [
            "Singleton config — reject if program is paused."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tanda",
          "docs": [
            "Tanda PDA — created here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  110,
                  100,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "params.tanda_id"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Vault token account (PDA-owned, authority = tanda PDA)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tanda"
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "The token mint for this tanda.",
            "On localnet (feature = \"localnet\") any mint is accepted so tests can use",
            "fresh mints without a canonical USDC deployment.  On mainnet/devnet the",
            "mint is verified in-handler against program_config.usdc_mint."
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "createTandaParams"
            }
          }
        }
      ]
    },
    {
      "name": "initConfig",
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "programConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "docs": [
            "Only the designated deployer may call init_config (prevents front-run race condition).",
            "In localnet/test mode this constraint is skipped — see handler below."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initConfigParams"
            }
          }
        }
      ]
    },
    {
      "name": "initUserProfile",
      "discriminator": [
        148,
        35,
        126,
        247,
        28,
        169,
        135,
        175
      ],
      "accounts": [
        {
          "name": "userProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "wallet"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "phoneHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "countryCode",
          "type": {
            "array": [
              "u8",
              2
            ]
          }
        }
      ]
    },
    {
      "name": "joinTanda",
      "discriminator": [
        186,
        60,
        178,
        234,
        139,
        112,
        80,
        60
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tanda",
          "docs": [
            "The tanda to join — must be in Forming state."
          ],
          "writable": true
        },
        {
          "name": "member",
          "docs": [
            "Member PDA — created here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "tanda"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userUsdcAta",
          "docs": [
            "User's USDC token account (source of stake transfer)."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Vault — must be the one stored in tanda.vault."
          ],
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "turnNumber",
          "type": "u8"
        }
      ]
    },
    {
      "name": "openDispute",
      "discriminator": [
        137,
        25,
        99,
        119,
        23,
        223,
        161,
        42
      ],
      "accounts": [
        {
          "name": "opener",
          "writable": true,
          "signer": true
        },
        {
          "name": "openerMember",
          "docs": [
            "Opener's membership PDA for this tanda — proves they are an active member."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "tanda"
              },
              {
                "kind": "account",
                "path": "opener"
              }
            ]
          }
        },
        {
          "name": "tanda",
          "writable": true
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "dispute",
          "docs": [
            "Dispute PDA — initialised here.",
            "dispute_id = tanda.disputes_opened (before increment)."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "reasonHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "pause",
      "discriminator": [
        211,
        22,
        221,
        251,
        74,
        121,
        193,
        47
      ],
      "accounts": [
        {
          "name": "programConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "programConfig"
          ]
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "payout",
      "discriminator": [
        149,
        140,
        194,
        236,
        174,
        189,
        6,
        239
      ],
      "accounts": [
        {
          "name": "crank",
          "docs": [
            "Must equal program_config.crank_authority."
          ],
          "signer": true
        },
        {
          "name": "tanda",
          "writable": true
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "beneficiaryMember",
          "docs": [
            "The member whose turn it is to receive the payout.",
            "Validated in-handler: beneficiary_member.tanda == tanda.key()",
            "beneficiary_member.turn_number == tanda.current_turn"
          ],
          "writable": true
        },
        {
          "name": "beneficiaryUsdcAta",
          "docs": [
            "Beneficiary's USDC token account."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Vault — PDA-owned by the tanda account. The CPI will use the tanda PDA as signer."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tanda"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "resolveDispute",
      "discriminator": [
        231,
        6,
        202,
        6,
        96,
        103,
        12,
        230
      ],
      "accounts": [
        {
          "name": "resolver",
          "docs": [
            "Anyone may call resolve after the voting deadline — it's a public-good crank."
          ],
          "signer": true
        },
        {
          "name": "dispute",
          "writable": true
        },
        {
          "name": "tanda",
          "docs": [
            "Must equal dispute.tanda."
          ],
          "writable": true
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "slashDefaulter",
      "discriminator": [
        70,
        94,
        170,
        113,
        252,
        54,
        188,
        174
      ],
      "accounts": [
        {
          "name": "crank",
          "docs": [
            "Must equal program_config.crank_authority."
          ],
          "signer": true
        },
        {
          "name": "tanda",
          "writable": true
        },
        {
          "name": "defaulterMember",
          "docs": [
            "The member to slash. Validated in-handler:",
            "- defaulter_member.tanda == tanda.key()",
            "- defaulter_member.is_active",
            "- has missed current turn contribution past grace period"
          ],
          "writable": true
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Vault PDA — source of the slashed stake."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tanda"
              }
            ]
          }
        },
        {
          "name": "feeDestinationAta",
          "docs": [
            "Treasury destination for slashed stake — must be owned by program_config.fee_destination."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "startTanda",
      "discriminator": [
        190,
        76,
        73,
        151,
        165,
        180,
        194,
        250
      ],
      "accounts": [
        {
          "name": "creator",
          "docs": [
            "Must be the tanda creator."
          ],
          "signer": true,
          "relations": [
            "tanda"
          ]
        },
        {
          "name": "tanda",
          "writable": true
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updateKycTier",
      "discriminator": [
        40,
        190,
        167,
        168,
        194,
        22,
        51,
        30
      ],
      "accounts": [
        {
          "name": "userProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "wallet"
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "kycOracle",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newTier",
          "type": {
            "defined": {
              "name": "kycTier"
            }
          }
        }
      ]
    },
    {
      "name": "voteDispute",
      "discriminator": [
        23,
        190,
        211,
        170,
        65,
        223,
        4,
        243
      ],
      "accounts": [
        {
          "name": "voter",
          "writable": true,
          "signer": true
        },
        {
          "name": "voterMember",
          "docs": [
            "Voter's membership PDA — proves they are an active member of the tanda under dispute."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "dispute.tanda",
                "account": "dispute"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "dispute",
          "writable": true
        },
        {
          "name": "disputeVote",
          "docs": [
            "DisputeVote PDA — `init` enforces one vote per (dispute, voter) pair.",
            "A second call with the same voter will fail with AccountAlreadyInitialized."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101,
                  95,
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "dispute"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "programConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "continueTanda",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "dispute",
      "discriminator": [
        36,
        49,
        241,
        67,
        40,
        36,
        241,
        74
      ]
    },
    {
      "name": "disputeVote",
      "discriminator": [
        166,
        202,
        140,
        76,
        65,
        35,
        254,
        149
      ]
    },
    {
      "name": "member",
      "discriminator": [
        54,
        19,
        162,
        21,
        29,
        166,
        17,
        198
      ]
    },
    {
      "name": "programConfig",
      "discriminator": [
        196,
        210,
        90,
        231,
        144,
        149,
        140,
        63
      ]
    },
    {
      "name": "tanda",
      "discriminator": [
        71,
        87,
        147,
        93,
        220,
        59,
        176,
        127
      ]
    },
    {
      "name": "userProfile",
      "discriminator": [
        32,
        37,
        119,
        205,
        179,
        180,
        13,
        194
      ]
    }
  ],
  "events": [
    {
      "name": "badgeMinted",
      "discriminator": [
        53,
        227,
        68,
        72,
        115,
        78,
        25,
        14
      ]
    },
    {
      "name": "contributionMade",
      "discriminator": [
        81,
        218,
        72,
        109,
        93,
        96,
        131,
        199
      ]
    },
    {
      "name": "disputeOpened",
      "discriminator": [
        239,
        222,
        102,
        235,
        193,
        85,
        1,
        214
      ]
    },
    {
      "name": "disputeResolved",
      "discriminator": [
        121,
        64,
        249,
        153,
        139,
        128,
        236,
        187
      ]
    },
    {
      "name": "disputeVoted",
      "discriminator": [
        246,
        199,
        201,
        173,
        194,
        194,
        97,
        73
      ]
    },
    {
      "name": "kycTierUpdated",
      "discriminator": [
        217,
        213,
        50,
        55,
        252,
        253,
        63,
        29
      ]
    },
    {
      "name": "memberJoined",
      "discriminator": [
        156,
        199,
        149,
        88,
        193,
        203,
        191,
        210
      ]
    },
    {
      "name": "memberSlashed",
      "discriminator": [
        124,
        72,
        4,
        248,
        87,
        145,
        200,
        136
      ]
    },
    {
      "name": "payoutExecuted",
      "discriminator": [
        88,
        83,
        101,
        64,
        188,
        233,
        117,
        185
      ]
    },
    {
      "name": "tandaCompleted",
      "discriminator": [
        218,
        223,
        124,
        177,
        60,
        155,
        0,
        53
      ]
    },
    {
      "name": "tandaCreated",
      "discriminator": [
        254,
        98,
        155,
        123,
        122,
        3,
        122,
        189
      ]
    },
    {
      "name": "tandaStarted",
      "discriminator": [
        160,
        63,
        223,
        151,
        15,
        136,
        81,
        166
      ]
    },
    {
      "name": "userProfileInitialized",
      "discriminator": [
        38,
        145,
        75,
        59,
        10,
        141,
        71,
        218
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "insufficientKyc",
      "msg": "Insufficient KYC tier for this action"
    },
    {
      "code": 6001,
      "name": "tandaNotForming",
      "msg": "Tanda is not in Forming state"
    },
    {
      "code": 6002,
      "name": "tandaNotActive",
      "msg": "Tanda is not Active"
    },
    {
      "code": 6003,
      "name": "tandaPaused",
      "msg": "Tanda is paused due to dispute"
    },
    {
      "code": 6004,
      "name": "tandaFull",
      "msg": "Tanda is full"
    },
    {
      "code": 6005,
      "name": "invalidMemberCount",
      "msg": "Tanda member count must be between 3 and 20"
    },
    {
      "code": 6006,
      "name": "turnAlreadyTaken",
      "msg": "Turn number already taken"
    },
    {
      "code": 6007,
      "name": "alreadyContributed",
      "msg": "Member has already contributed this turn"
    },
    {
      "code": 6008,
      "name": "payoutNotReady",
      "msg": "Payout time has not been reached"
    },
    {
      "code": 6009,
      "name": "missingContributions",
      "msg": "All members must contribute before payout"
    },
    {
      "code": 6010,
      "name": "disputeStillOpen",
      "msg": "Dispute voting window has not closed"
    },
    {
      "code": 6011,
      "name": "alreadyVoted",
      "msg": "User has already voted on this dispute"
    },
    {
      "code": 6012,
      "name": "notAMember",
      "msg": "Caller is not a member of this tanda"
    },
    {
      "code": 6013,
      "name": "notCreator",
      "msg": "Caller is not the tanda creator"
    },
    {
      "code": 6014,
      "name": "unauthorized",
      "msg": "Caller is not authorized"
    },
    {
      "code": 6015,
      "name": "programPaused",
      "msg": "Program is paused"
    },
    {
      "code": 6016,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6017,
      "name": "invalidStake",
      "msg": "Stake amount must be greater than zero"
    },
    {
      "code": 6018,
      "name": "invalidFeeBps",
      "msg": "fee_bps must be <= 10000 (100%)"
    },
    {
      "code": 6019,
      "name": "invalidKycLimits",
      "msg": "kyc_limits[0] must be > 0 and the array must be monotonic non-decreasing"
    },
    {
      "code": 6020,
      "name": "invalidFrequency",
      "msg": "frequency_seconds must be at least 86400 (24 hours)"
    },
    {
      "code": 6021,
      "name": "kycInsufficientForAmount",
      "msg": "KYC tier insufficient for the requested contribution + stake amount"
    },
    {
      "code": 6022,
      "name": "memberInactive",
      "msg": "Member is not active (slashed)"
    },
    {
      "code": 6023,
      "name": "alreadyPaidOut",
      "msg": "Beneficiary has already received their payout"
    },
    {
      "code": 6024,
      "name": "notImplemented",
      "msg": "Payout order mode not yet implemented; use JoinOrder"
    },
    {
      "code": 6025,
      "name": "disputeNotOpen",
      "msg": "Dispute is not in Open state"
    },
    {
      "code": 6026,
      "name": "disputeExpired",
      "msg": "Dispute voting window has expired"
    },
    {
      "code": 6027,
      "name": "disputeNotExpired",
      "msg": "Dispute voting window has not expired yet"
    },
    {
      "code": 6028,
      "name": "memberNotDefaulted",
      "msg": "Member has not defaulted (contributions up to date or grace period not elapsed)"
    },
    {
      "code": 6029,
      "name": "maxDisputesReached",
      "msg": "Maximum number of disputes per tanda reached"
    }
  ],
  "types": [
    {
      "name": "badgeMinted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "badgeType",
            "type": "u8"
          },
          {
            "name": "source",
            "type": "pubkey"
          },
          {
            "name": "value",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "contributionMade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "turn",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "createTandaParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tandaId",
            "type": "u64"
          },
          {
            "name": "nameHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "memberTarget",
            "type": "u8"
          },
          {
            "name": "contributionAmount",
            "type": "u64"
          },
          {
            "name": "stakeAmount",
            "type": "u64"
          },
          {
            "name": "frequencySeconds",
            "type": "u32"
          },
          {
            "name": "payoutOrderMode",
            "type": {
              "defined": {
                "name": "payoutOrder"
              }
            }
          }
        ]
      }
    },
    {
      "name": "dispute",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "disputeId",
            "type": "u8"
          },
          {
            "name": "opener",
            "type": "pubkey"
          },
          {
            "name": "reasonHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "deadlineTs",
            "type": "i64"
          },
          {
            "name": "votesContinue",
            "type": "u8"
          },
          {
            "name": "votesCancel",
            "type": "u8"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "disputeState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "disputeOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "opener",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "disputeResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "continueTanda",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "disputeState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "resolved"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "disputeVote",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "voter",
            "type": "pubkey"
          },
          {
            "name": "continueTanda",
            "type": "bool"
          },
          {
            "name": "votedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "disputeVoted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "dispute",
            "type": "pubkey"
          },
          {
            "name": "voter",
            "type": "pubkey"
          },
          {
            "name": "continueTanda",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "initConfigParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kycOracle",
            "type": "pubkey"
          },
          {
            "name": "crankAuthority",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "feeDestination",
            "type": "pubkey"
          },
          {
            "name": "kycLimits",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          }
        ]
      }
    },
    {
      "name": "kycTier",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "t0Demo"
          },
          {
            "name": "t1Lite"
          },
          {
            "name": "t2Standard"
          },
          {
            "name": "t3Pro"
          }
        ]
      }
    },
    {
      "name": "kycTierUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "newTier",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "member",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "turnNumber",
            "type": "u8"
          },
          {
            "name": "contributionsMade",
            "type": "u8"
          },
          {
            "name": "lastContributionTs",
            "type": "i64"
          },
          {
            "name": "stakeLocked",
            "type": "u64"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "hasReceivedPayout",
            "type": "bool"
          },
          {
            "name": "joinedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "memberJoined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "turnNumber",
            "type": "u8"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "memberSlashed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "member",
            "type": "pubkey"
          },
          {
            "name": "stakeLost",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "payoutExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "beneficiary",
            "type": "pubkey"
          },
          {
            "name": "turn",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "payoutOrder",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "joinOrder"
          },
          {
            "name": "creatorSet"
          },
          {
            "name": "random"
          }
        ]
      }
    },
    {
      "name": "programConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "kycOracle",
            "type": "pubkey"
          },
          {
            "name": "crankAuthority",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "feeDestination",
            "type": "pubkey"
          },
          {
            "name": "kycLimits",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tanda",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "tandaId",
            "type": "u64"
          },
          {
            "name": "nameHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "memberTarget",
            "type": "u8"
          },
          {
            "name": "memberCurrent",
            "type": "u8"
          },
          {
            "name": "contributionAmount",
            "type": "u64"
          },
          {
            "name": "stakeAmount",
            "type": "u64"
          },
          {
            "name": "frequencySeconds",
            "type": "u32"
          },
          {
            "name": "totalTurns",
            "type": "u8"
          },
          {
            "name": "currentTurn",
            "type": "u8"
          },
          {
            "name": "contributionsThisTurn",
            "docs": [
              "Running count of contributions received for the current turn.",
              "Incremented by `contribute`, reset to 0 after each `payout`."
            ],
            "type": "u8"
          },
          {
            "name": "disputesOpened",
            "docs": [
              "Running count of disputes opened against this tanda (max 5)."
            ],
            "type": "u8"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "tandaState"
              }
            }
          },
          {
            "name": "payoutOrderMode",
            "type": {
              "defined": {
                "name": "payoutOrder"
              }
            }
          },
          {
            "name": "nextPayoutTs",
            "type": "i64"
          },
          {
            "name": "startedAt",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tandaCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tandaCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "memberTarget",
            "type": "u8"
          },
          {
            "name": "contributionAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tandaStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tanda",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tandaState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "forming"
          },
          {
            "name": "active"
          },
          {
            "name": "paused"
          },
          {
            "name": "completed"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "userProfile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "phoneHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "countryCode",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "kycTier",
            "type": {
              "defined": {
                "name": "kycTier"
              }
            }
          },
          {
            "name": "reputationScore",
            "type": "u32"
          },
          {
            "name": "tandasCompleted",
            "type": "u16"
          },
          {
            "name": "tandasDefaulted",
            "type": "u16"
          },
          {
            "name": "tandasCreated",
            "type": "u64"
          },
          {
            "name": "loansRepaid",
            "type": "u16"
          },
          {
            "name": "loansDefaulted",
            "type": "u16"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "userProfileInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "phoneHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "countryCode",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
