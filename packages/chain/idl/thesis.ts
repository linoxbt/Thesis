/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/thesis.json`.
 */
export type Thesis = {
  "address": "9yVcFaDEmBk1VU66tXxuvUujZXfiiT3ED1EpioVuug6h",
  "metadata": {
    "name": "thesis",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Thesis: touch markets on the pm-AMM, resolved by Pyth proofs"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "docs": [
        "The proposed admin takes over by signing."
      ],
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "newAdmin",
          "signer": true
        },
        {
          "name": "config",
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
        }
      ],
      "args": []
    },
    {
      "name": "claimCreatorFees",
      "docs": [
        "Creator: withdraw the earned share of fees attributed to a thesis."
      ],
      "discriminator": [
        0,
        23,
        125,
        234,
        156,
        118,
        134,
        89
      ],
      "accounts": [
        {
          "name": "creator",
          "signer": true,
          "relations": [
            "thesis"
          ]
        },
        {
          "name": "config",
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
          "name": "authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "thesis",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  115,
                  105,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "account",
                "path": "thesis.id",
                "account": "thesis"
              }
            ]
          }
        },
        {
          "name": "creatorStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
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
          "name": "creatorUsdc",
          "writable": true
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createThesis",
      "docs": [
        "Creator: link their own open conviction market (and optional opposite",
        "protection market) into a public thesis."
      ],
      "discriminator": [
        211,
        194,
        95,
        96,
        95,
        148,
        109,
        108
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
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
          "name": "creatorStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
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
          "name": "thesis",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  115,
                  105,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "account",
                "path": "creator_stats.next_thesis_id",
                "account": "creatorStats"
              }
            ]
          }
        },
        {
          "name": "convictionMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "conviction_market.pm_market",
                "account": "touchMarket"
              }
            ]
          }
        },
        {
          "name": "protectionMarket",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "protection_market.pm_market",
                "account": "touchMarket"
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
          "name": "textHash",
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
      "name": "createTouchMarket",
      "docs": [
        "Anyone: create a touch market. The opening price is computed onchain",
        "from a fresh Pyth spot and `Config.sol_vol_bps`; the pm-AMM market's",
        "authority is the `Authority` PDA. Seeded by the creator, or by the",
        "treasury when an admin/keeper sponsors it."
      ],
      "discriminator": [
        81,
        251,
        243,
        40,
        213,
        68,
        98,
        237
      ],
      "accounts": [
        {
          "name": "creator",
          "docs": [
            "The creator. Pays the TouchMarket rent, reimburses the Authority for the",
            "pm-AMM accounts it pays for, and pays the seed unless sponsored."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
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
          "name": "authority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creatorUsdc",
          "docs": [
            "The creator's USDC; required unless `sponsored`."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "priceUpdate"
        },
        {
          "name": "pmMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "args.market_id"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                230,
                11,
                216,
                166,
                97,
                199,
                123,
                207,
                167,
                171,
                211,
                156,
                233,
                61,
                237,
                53,
                57,
                36,
                9,
                216,
                222,
                103,
                112,
                255,
                94,
                34,
                20,
                176,
                230,
                154,
                132,
                194
              ]
            }
          }
        },
        {
          "name": "yesMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  121,
                  101,
                  115,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pmMarket"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                230,
                11,
                216,
                166,
                97,
                199,
                123,
                207,
                167,
                171,
                211,
                156,
                233,
                61,
                237,
                53,
                57,
                36,
                9,
                216,
                222,
                103,
                112,
                255,
                94,
                34,
                20,
                176,
                230,
                154,
                132,
                194
              ]
            }
          }
        },
        {
          "name": "noMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  111,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pmMarket"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                230,
                11,
                216,
                166,
                97,
                199,
                123,
                207,
                167,
                171,
                211,
                156,
                233,
                61,
                237,
                53,
                57,
                36,
                9,
                216,
                222,
                103,
                112,
                255,
                94,
                34,
                20,
                176,
                230,
                154,
                132,
                194
              ]
            }
          }
        },
        {
          "name": "vault",
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
                "path": "pmMarket"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                230,
                11,
                216,
                166,
                97,
                199,
                123,
                207,
                167,
                171,
                211,
                156,
                233,
                61,
                237,
                53,
                57,
                36,
                9,
                216,
                222,
                103,
                112,
                255,
                94,
                34,
                20,
                176,
                230,
                154,
                132,
                194
              ]
            }
          }
        },
        {
          "name": "yesMetadata",
          "writable": true
        },
        {
          "name": "noMetadata",
          "writable": true
        },
        {
          "name": "lpPosition",
          "docs": [
            "Authority if sponsored, else the creator); pm-AMM checks the seeds."
          ],
          "writable": true
        },
        {
          "name": "touchMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "pmMarket"
              }
            ]
          }
        },
        {
          "name": "pmAmmProgram",
          "address": "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"
        },
        {
          "name": "tokenMetadataProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createTouchMarketArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initializeConfig",
      "docs": [
        "Admin, once: writes `Config`, funds the `Authority` PDA with a SOL float",
        "(creators repay what market creation spends from it), and creates the",
        "treasury (the Authority's USDC ATA)."
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
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
          "name": "authority",
          "docs": [
            "System-owned PDA with no data: signs every pm-AMM CPI and pays its rent."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "treasury",
          "docs": [
            "The treasury: receives the creator half of every swap fee."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "migrateConfig",
      "docs": [
        "Admin, once per deployment that predates v2: resize `Config` and set",
        "the creator fees already owed."
      ],
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "can't deserialize as the v2 struct)."
          ],
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "creatorFeesOwed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "proveTouch",
      "docs": [
        "Anyone: submit a fully verified Pyth price update that shows the touch."
      ],
      "discriminator": [
        185,
        63,
        164,
        110,
        251,
        155,
        91,
        9
      ],
      "accounts": [
        {
          "name": "prover",
          "signer": true
        },
        {
          "name": "config",
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
          "name": "touchMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "touch_market.pm_market",
                "account": "touchMarket"
              }
            ]
          }
        },
        {
          "name": "priceUpdate"
        }
      ],
      "args": []
    },
    {
      "name": "setVolatility",
      "docs": [
        "Keeper or admin: post SOL's annualised volatility (bps)."
      ],
      "discriminator": [
        253,
        115,
        211,
        92,
        223,
        46,
        55,
        28
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "config",
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
        }
      ],
      "args": [
        {
          "name": "solVolBps",
          "type": "u32"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Anyone, after `end_ts + grace_secs`: resolve YES if touched, else NO.",
        "Records the thesis outcome when its conviction market settles."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Anyone may crank settlement; the keeper does it by default."
          ],
          "signer": true
        },
        {
          "name": "config",
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
          "name": "authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "touchMarket",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "touch_market.pm_market",
                "account": "touchMarket"
              }
            ]
          }
        },
        {
          "name": "pmMarket",
          "writable": true
        },
        {
          "name": "pmAmmProgram",
          "address": "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"
        },
        {
          "name": "thesis",
          "docs": [
            "Required when the market belongs to a thesis (`origin_thesis`)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "creatorStats",
          "docs": [
            "The thesis creator's stats; required with `thesis`."
          ],
          "writable": true,
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "trade",
      "docs": [
        "Any trader: back, challenge or protect through Thesis so the creator",
        "earns their fee share. Closed once the market is touched."
      ],
      "discriminator": [
        178,
        144,
        26,
        216,
        241,
        187,
        206,
        130
      ],
      "accounts": [
        {
          "name": "trader",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "Writable: records the creator fees this trade adds to what's owed."
          ],
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
          "name": "authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "docs": [
            "Receives the creator half of pm-AMM's fee; the balance change is the",
            "fee attributed to this thesis."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "thesis",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  104,
                  101,
                  115,
                  105,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "thesis.creator",
                "account": "thesis"
              },
              {
                "kind": "account",
                "path": "thesis.id",
                "account": "thesis"
              }
            ]
          }
        },
        {
          "name": "creatorStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "thesis.creator",
                "account": "thesis"
              }
            ]
          }
        },
        {
          "name": "touchMarket",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "touch_market.pm_market",
                "account": "touchMarket"
              }
            ]
          }
        },
        {
          "name": "pmMarket",
          "writable": true
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "traderUsdc",
          "writable": true
        },
        {
          "name": "traderYes",
          "docs": [
            "The trader's YES ATA: one account per wallet, so the cover cap below",
            "can't be dodged by spreading YES across accounts."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "yesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "traderNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "trader"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "noMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "daoUsdc",
          "writable": true
        },
        {
          "name": "pmAmmProgram",
          "address": "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "tradeSide"
            }
          }
        },
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minOutput",
          "type": "u64"
        }
      ]
    },
    {
      "name": "treasuryBuyYes",
      "docs": [
        "Keeper: after a proven touch, buy underpriced YES with treasury USDC."
      ],
      "discriminator": [
        125,
        110,
        194,
        105,
        137,
        220,
        42,
        101
      ],
      "accounts": [
        {
          "name": "keeper",
          "signer": true
        },
        {
          "name": "config",
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
          "name": "authority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "touchMarket",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "touch_market.pm_market",
                "account": "touchMarket"
              }
            ]
          }
        },
        {
          "name": "pmMarket",
          "writable": true
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "treasuryYes",
          "writable": true
        },
        {
          "name": "treasuryNo",
          "writable": true
        },
        {
          "name": "daoUsdc",
          "writable": true
        },
        {
          "name": "pmAmmProgram",
          "address": "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minOutput",
          "type": "u64"
        }
      ]
    },
    {
      "name": "treasuryRedeem",
      "docs": [
        "Anyone, after settlement: claim a sponsored seed's LP residuals and redeem the",
        "Authority's YES/NO for USDC into the treasury."
      ],
      "discriminator": [
        154,
        179,
        45,
        198,
        243,
        135,
        180,
        77
      ],
      "accounts": [
        {
          "name": "cranker",
          "docs": [
            "Anyone may crank this: the USDC can only go to the treasury."
          ],
          "signer": true
        },
        {
          "name": "config",
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
          "name": "authority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "touchMarket",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "touch_market.pm_market",
                "account": "touchMarket"
              }
            ]
          }
        },
        {
          "name": "pmMarket",
          "writable": true
        },
        {
          "name": "usdcMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "yesMint",
          "writable": true
        },
        {
          "name": "noMint",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "treasuryYes",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "yesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasuryNo",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "noMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "lpPosition",
          "docs": [
            "markets only); seeds pinned here, contents read by pm-AMM."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "pmMarket"
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ],
            "program": {
              "kind": "account",
              "path": "pmAmmProgram"
            }
          }
        },
        {
          "name": "pmAmmProgram",
          "address": "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "claimResiduals",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateConfig",
      "docs": [
        "Admin: change config fields within `Config::validate`; `admin` only",
        "proposes a successor, and the creator share is fixed."
      ],
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
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
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateConfigArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "creatorStats",
      "discriminator": [
        239,
        158,
        112,
        237,
        227,
        82,
        97,
        129
      ]
    },
    {
      "name": "thesis",
      "discriminator": [
        234,
        135,
        245,
        206,
        132,
        164,
        99,
        8
      ]
    },
    {
      "name": "touchMarket",
      "discriminator": [
        154,
        86,
        210,
        17,
        152,
        125,
        71,
        59
      ]
    }
  ],
  "events": [
    {
      "name": "adminChanged",
      "discriminator": [
        232,
        34,
        31,
        226,
        62,
        18,
        19,
        114
      ]
    },
    {
      "name": "creatorFeesClaimed",
      "discriminator": [
        189,
        178,
        21,
        181,
        171,
        179,
        131,
        1
      ]
    },
    {
      "name": "settled",
      "discriminator": [
        232,
        210,
        40,
        17,
        142,
        124,
        145,
        238
      ]
    },
    {
      "name": "thesisCreated",
      "discriminator": [
        119,
        155,
        105,
        249,
        93,
        181,
        160,
        70
      ]
    },
    {
      "name": "touchMarketCreated",
      "discriminator": [
        149,
        234,
        115,
        230,
        128,
        218,
        195,
        110
      ]
    },
    {
      "name": "touched",
      "discriminator": [
        143,
        160,
        73,
        49,
        43,
        104,
        41,
        110
      ]
    },
    {
      "name": "traded",
      "discriminator": [
        225,
        202,
        73,
        175,
        147,
        43,
        160,
        150
      ]
    },
    {
      "name": "treasuryBought",
      "discriminator": [
        52,
        44,
        112,
        81,
        108,
        154,
        82,
        233
      ]
    },
    {
      "name": "treasuryRedeemed",
      "discriminator": [
        169,
        20,
        8,
        183,
        247,
        211,
        169,
        210
      ]
    },
    {
      "name": "volatilityUpdated",
      "discriminator": [
        65,
        23,
        5,
        195,
        172,
        173,
        255,
        87
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Only the admin or keeper may do this"
    },
    {
      "code": 6002,
      "name": "invalidSeed",
      "msg": "Seed amount is zero or above the per-market cap"
    },
    {
      "code": 6003,
      "name": "invalidStrike",
      "msg": "Strike must be positive"
    },
    {
      "code": 6004,
      "name": "invalidWindow",
      "msg": "Window must be longer than the pm-AMM minimum"
    },
    {
      "code": 6005,
      "name": "wrongPmAccount",
      "msg": "Account is not the expected pm-AMM PDA"
    },
    {
      "code": 6006,
      "name": "alreadyFinal",
      "msg": "Market already touched or settled"
    },
    {
      "code": 6007,
      "name": "wrongPriceOwner",
      "msg": "Price update is not owned by the Pyth receiver"
    },
    {
      "code": 6008,
      "name": "badPriceAccount",
      "msg": "Price update could not be decoded"
    },
    {
      "code": 6009,
      "name": "notFullyVerified",
      "msg": "Price update is not fully verified"
    },
    {
      "code": 6010,
      "name": "wrongFeed",
      "msg": "Price update is for another feed"
    },
    {
      "code": 6011,
      "name": "outsideWindow",
      "msg": "Price publish time is outside the market window"
    },
    {
      "code": 6012,
      "name": "wrongExpo",
      "msg": "Price exponent differs from the strike exponent"
    },
    {
      "code": 6013,
      "name": "nonPositivePrice",
      "msg": "Price is not positive"
    },
    {
      "code": 6014,
      "name": "confTooWide",
      "msg": "Confidence interval is too wide"
    },
    {
      "code": 6015,
      "name": "noTouch",
      "msg": "Price did not cross the strike"
    },
    {
      "code": 6016,
      "name": "tooEarly",
      "msg": "Too early to settle"
    },
    {
      "code": 6017,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6018,
      "name": "staleSpot",
      "msg": "Spot price is too old"
    },
    {
      "code": 6019,
      "name": "staleVolatility",
      "msg": "Volatility has not been updated recently"
    },
    {
      "code": 6020,
      "name": "strikeWrongSide",
      "msg": "TouchBelow needs a strike under spot, TouchAbove one over spot"
    },
    {
      "code": 6021,
      "name": "strikeTooClose",
      "msg": "Strike is too close to spot"
    },
    {
      "code": 6022,
      "name": "strikeTooFar",
      "msg": "Strike is too far from spot"
    },
    {
      "code": 6023,
      "name": "openingPriceOutOfRange",
      "msg": "Opening probability is outside the allowed range"
    },
    {
      "code": 6024,
      "name": "sponsorNotAllowed",
      "msg": "Only the admin or keeper may sponsor a market"
    },
    {
      "code": 6025,
      "name": "sponsorBudgetExhausted",
      "msg": "Sponsor budget exhausted"
    },
    {
      "code": 6026,
      "name": "missingCreatorUsdc",
      "msg": "Creator USDC account required for a creator-seeded market"
    },
    {
      "code": 6027,
      "name": "invalidVolatility",
      "msg": "Volatility out of range"
    },
    {
      "code": 6028,
      "name": "invalidConfig",
      "msg": "Invalid config value"
    },
    {
      "code": 6029,
      "name": "notMarketCreator",
      "msg": "Market was not created by this creator"
    },
    {
      "code": 6030,
      "name": "marketAlreadyLinked",
      "msg": "Market already belongs to a thesis"
    },
    {
      "code": 6031,
      "name": "protectionSameDirection",
      "msg": "Protection market must point the opposite way from the conviction market"
    },
    {
      "code": 6032,
      "name": "marketsMismatch",
      "msg": "Markets must share feed and end time"
    },
    {
      "code": 6033,
      "name": "marketNotInThesis",
      "msg": "Market is not part of this thesis"
    },
    {
      "code": 6034,
      "name": "marketClosed",
      "msg": "Market is touched or settled; trading through Thesis is closed"
    },
    {
      "code": 6035,
      "name": "zeroAmount",
      "msg": "Amount must be positive"
    },
    {
      "code": 6036,
      "name": "coverCapExceeded",
      "msg": "Cover above the per-wallet cap"
    },
    {
      "code": 6037,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6038,
      "name": "missingThesisAccounts",
      "msg": "Thesis accounts are required to settle a thesis market"
    },
    {
      "code": 6039,
      "name": "notTouched",
      "msg": "Market must be touched first"
    },
    {
      "code": 6040,
      "name": "futurePrice",
      "msg": "Price publish time is too far in the future"
    },
    {
      "code": 6041,
      "name": "treasuryReserved",
      "msg": "Treasury USDC is reserved for creator fees owed"
    },
    {
      "code": 6042,
      "name": "windowTooLong",
      "msg": "Window is longer than allowed"
    },
    {
      "code": 6043,
      "name": "linkWindowPassed",
      "msg": "Market opened too long ago to join a thesis"
    },
    {
      "code": 6044,
      "name": "proofTooLate",
      "msg": "The grace period is over; settle instead"
    },
    {
      "code": 6045,
      "name": "notSettled",
      "msg": "Market is not settled yet"
    },
    {
      "code": 6046,
      "name": "notPendingAdmin",
      "msg": "Signer is not the pending admin"
    },
    {
      "code": 6047,
      "name": "creatorShareFixed",
      "msg": "The creator share can't change after launch"
    },
    {
      "code": 6048,
      "name": "wrongDaoAccount",
      "msg": "dao_usdc must be the protocol DAO's USDC account"
    },
    {
      "code": 6049,
      "name": "alreadyMigrated",
      "msg": "Config is already migrated"
    },
    {
      "code": 6050,
      "name": "wrongCreatorStats",
      "msg": "Creator stats do not belong to this thesis's creator"
    },
    {
      "code": 6051,
      "name": "beneficiaryNeedsSponsor",
      "msg": "Only a sponsored market can name a beneficiary"
    }
  ],
  "types": [
    {
      "name": "adminChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldAdmin",
            "type": "pubkey"
          },
          {
            "name": "newAdmin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "pmAmmProgram",
            "type": "pubkey"
          },
          {
            "name": "pythReceiver",
            "type": "pubkey"
          },
          {
            "name": "solUsdFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creatorShareBps",
            "docs": [
              "Creator share of the treasury's swap fee, in bps (5000 at launch)."
            ],
            "type": "u16"
          },
          {
            "name": "lpRebateBps",
            "docs": [
              "Share of creator fees rebated to LPs (0 at launch; v2)."
            ],
            "type": "u16"
          },
          {
            "name": "graceSecs",
            "docs": [
              "Seconds after `end_ts` during which a late proof may still land."
            ],
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "docs": [
              "Max Pyth confidence as a share of price, in bps."
            ],
            "type": "u16"
          },
          {
            "name": "minSeedPerMarket",
            "type": "u64"
          },
          {
            "name": "maxSeedPerMarket",
            "type": "u64"
          },
          {
            "name": "maxCoverPerWallet",
            "type": "u64"
          },
          {
            "name": "sponsorBudget",
            "docs": [
              "Treasury USDC still available for sponsored seeds (launch subsidy)."
            ],
            "type": "u64"
          },
          {
            "name": "solVolBps",
            "docs": [
              "SOL annualised volatility in bps (6000 = 60%), set by the keeper."
            ],
            "type": "u32"
          },
          {
            "name": "volUpdatedTs",
            "type": "i64"
          },
          {
            "name": "maxVolAgeSecs",
            "docs": [
              "Market creation fails if `sol_vol_bps` is older than this."
            ],
            "type": "u32"
          },
          {
            "name": "maxSpotAgeSecs",
            "docs": [
              "Market creation needs a spot price no older than this."
            ],
            "type": "u32"
          },
          {
            "name": "minStrikeDistanceBps",
            "docs": [
              "Strike distance from spot, in bps of spot (spec: 0.5%..50%)."
            ],
            "type": "u16"
          },
          {
            "name": "maxStrikeDistanceBps",
            "type": "u16"
          },
          {
            "name": "minOpenBps",
            "docs": [
              "Allowed opening probability, in bps (spec: 1%..99%)."
            ],
            "type": "u16"
          },
          {
            "name": "maxOpenBps",
            "type": "u16"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "authorityBump",
            "type": "u8"
          },
          {
            "name": "pendingAdmin",
            "docs": [
              "Admin proposed by `update_config`; takes over only on `accept_admin`."
            ],
            "type": "pubkey"
          },
          {
            "name": "creatorFeesOwed",
            "docs": [
              "Creator fees earned but not yet claimed. Treasury spends (sponsored",
              "seeds, treasury buys) must leave at least this much behind."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "createTouchMarketArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "docs": [
              "pm-AMM market id. pm-AMM ids share one namespace across every user of",
              "the pm-AMM, and any id the program derived would be predictable (so",
              "easier to squat). Clients send a random u64 and retry with a new one if",
              "the CPI reports the market account already exists."
            ],
            "type": "u64"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "strike",
            "docs": [
              "Strike in the same exponent as the spot price update."
            ],
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "seedAmount",
            "type": "u64"
          },
          {
            "name": "sponsored",
            "docs": [
              "Seed from the treasury (admin/keeper only, within `sponsor_budget`)",
              "instead of from the creator's own USDC."
            ],
            "type": "bool"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "beneficiary",
            "docs": [
              "Sponsored markets only: the wallet the market is created for (it can",
              "link the market into its own thesis). None = the signer."
            ],
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "creatorFeesClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "thesis",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "nextThesisId",
            "type": "u64"
          },
          {
            "name": "posted",
            "type": "u32"
          },
          {
            "name": "hit",
            "type": "u32"
          },
          {
            "name": "missed",
            "type": "u32"
          },
          {
            "name": "totalVolume",
            "type": "u64"
          },
          {
            "name": "totalFeesEarned",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "direction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "above"
          },
          {
            "name": "below"
          }
        ]
      }
    },
    {
      "name": "initializeConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "keeper",
            "type": "pubkey"
          },
          {
            "name": "solUsdFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creatorShareBps",
            "type": "u16"
          },
          {
            "name": "graceSecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "minSeedPerMarket",
            "type": "u64"
          },
          {
            "name": "maxSeedPerMarket",
            "type": "u64"
          },
          {
            "name": "maxCoverPerWallet",
            "type": "u64"
          },
          {
            "name": "sponsorBudget",
            "type": "u64"
          },
          {
            "name": "solVolBps",
            "type": "u32"
          },
          {
            "name": "maxVolAgeSecs",
            "type": "u32"
          },
          {
            "name": "maxSpotAgeSecs",
            "type": "u32"
          },
          {
            "name": "minStrikeDistanceBps",
            "type": "u16"
          },
          {
            "name": "maxStrikeDistanceBps",
            "type": "u16"
          },
          {
            "name": "minOpenBps",
            "type": "u16"
          },
          {
            "name": "maxOpenBps",
            "type": "u16"
          },
          {
            "name": "authorityFunding",
            "docs": [
              "Lamports moved to the Authority PDA to pay pm-AMM rent."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "settled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "touchMarket",
            "type": "pubkey"
          },
          {
            "name": "winningSide",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "thesis",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "convictionMarket",
            "docs": [
              "TouchMarket PDA the crowd backs or challenges."
            ],
            "type": "pubkey"
          },
          {
            "name": "protectionMarket",
            "docs": [
              "TouchMarket PDA for the creator's cover; default = none."
            ],
            "type": "pubkey"
          },
          {
            "name": "textHash",
            "docs": [
              "sha256 of the thesis text (text lives offchain)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "volumeUsdc",
            "docs": [
              "USDC moved by trades routed through `trade` (both markets)."
            ],
            "type": "u64"
          },
          {
            "name": "selfVolumeUsdc",
            "docs": [
              "Part of `volume_usdc` traded by the creator's own wallet."
            ],
            "type": "u64"
          },
          {
            "name": "feesAttributed",
            "docs": [
              "Treasury fee income from trades routed through `trade`."
            ],
            "type": "u64"
          },
          {
            "name": "feesClaimed",
            "docs": [
              "Creator share already paid out."
            ],
            "type": "u64"
          },
          {
            "name": "outcome",
            "docs": [
              "0 open, 1 hit (conviction market touched), 2 missed."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "thesisCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "thesis",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "convictionMarket",
            "type": "pubkey"
          },
          {
            "name": "protectionMarket",
            "type": "pubkey"
          },
          {
            "name": "textHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "endTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "touchMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pmMarket",
            "type": "pubkey"
          },
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "strike",
            "docs": [
              "Strike in Pyth units: real price = strike * 10^expo."
            ],
            "type": "i64"
          },
          {
            "name": "expo",
            "type": "i32"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "initialPriceBps",
            "type": "u16"
          },
          {
            "name": "touched",
            "type": "bool"
          },
          {
            "name": "touchPrice",
            "type": "i64"
          },
          {
            "name": "touchPublishTime",
            "type": "i64"
          },
          {
            "name": "prover",
            "type": "pubkey"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "winningSide",
            "docs": [
              "0 = unresolved, 1 = YES, 2 = NO (same encoding as pm-AMM)."
            ],
            "type": "u8"
          },
          {
            "name": "originThesis",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "seededBy",
            "docs": [
              "Authority PDA for sponsored markets, else the creator."
            ],
            "type": "pubkey"
          },
          {
            "name": "seedAmount",
            "type": "u64"
          },
          {
            "name": "spotAtOpen",
            "docs": [
              "Pyth spot the opening price was computed from."
            ],
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
      "name": "touchMarketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "touchMarket",
            "type": "pubkey"
          },
          {
            "name": "pmMarket",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "strike",
            "type": "i64"
          },
          {
            "name": "expo",
            "type": "i32"
          },
          {
            "name": "spot",
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "initialPriceBps",
            "type": "u16"
          },
          {
            "name": "seedAmount",
            "type": "u64"
          },
          {
            "name": "sponsored",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "touched",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "touchMarket",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "publishTime",
            "type": "i64"
          },
          {
            "name": "prover",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "tradeSide",
      "docs": [
        "What a trader does through `trade`. Buys spend USDC; sells receive it."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "buyYes"
          },
          {
            "name": "buyNo"
          },
          {
            "name": "sellYes"
          },
          {
            "name": "sellNo"
          }
        ]
      }
    },
    {
      "name": "traded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "thesis",
            "type": "pubkey"
          },
          {
            "name": "touchMarket",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "tradeSide"
              }
            }
          },
          {
            "name": "usdcAmount",
            "type": "u64"
          },
          {
            "name": "tokenAmount",
            "type": "u64"
          },
          {
            "name": "feeToTreasury",
            "type": "u64"
          },
          {
            "name": "isCreator",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "treasuryBought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "touchMarket",
            "type": "pubkey"
          },
          {
            "name": "usdcIn",
            "type": "u64"
          },
          {
            "name": "yesOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "treasuryRedeemed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "touchMarket",
            "type": "pubkey"
          },
          {
            "name": "usdcOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateConfigArgs",
      "docs": [
        "Every field optional: only the ones sent change. `admin` only proposes a",
        "new admin (it takes over on `accept_admin`), and `creator_share_bps` can't",
        "change, because creators' earned fees are computed from it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "keeper",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "creatorShareBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "lpRebateBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "graceSecs",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "maxConfBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "minSeedPerMarket",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxSeedPerMarket",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxCoverPerWallet",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "sponsorBudget",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxVolAgeSecs",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "maxSpotAgeSecs",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "minStrikeDistanceBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "maxStrikeDistanceBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "minOpenBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "maxOpenBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          }
        ]
      }
    },
    {
      "name": "volatilityUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "solVolBps",
            "type": "u32"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
