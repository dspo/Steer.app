# ucs-detect 记录（2026-11-18）

`bun run conformance -- ucs`（issue #46 阶段 3，记录制）：ucs-detect 2.3.9，
Unicode 18.0.0，仿真内核只测（headless 会话，无字体管线），全程 1 秒。

终端识别为 Zu（XTVERSION 接线生效）；歧义宽度 1。

## 分项（通过/总数）

```
emoji_vs15_results v9.0.0: 158/158 (100.00%)
emoji_vs16_results v9.0.0: 426/426 (100.00%)
emoji_zwj_results v18.0.0: 1445/1445 (100.00%)
language_results [Aja]: 3/3 (100.00%)
language_results [Amarakaeri]: 6/6 (100.00%)
language_results [Arabic, Standard]: 8/8 (100.00%)
language_results [Assyrian Neo-Aramaic]: 8/8 (100.00%)
language_results [Baatonum]: 1/1 (100.00%)
language_results [Bamun]: 17/17 (100.00%)
language_results [Belanda Viri]: 3/3 (100.00%)
language_results [Bengali]: 239/335 (71.34%)
language_results [Bhojpuri]: 211/252 (83.73%)
language_results [Bora]: 2/2 (100.00%)
language_results [Burmese]: 213/223 (95.52%)
language_results [Catalan (2)]: 6/6 (100.00%)
language_results [Chakma]: 212/225 (94.22%)
language_results [Chickasaw]: 4/4 (100.00%)
language_results [Chinantec, Chiltepec]: 6/6 (100.00%)
language_results [Dagaare, Southern]: 3/3 (100.00%)
language_results [Dari]: 6/6 (100.00%)
language_results [Dendi]: 1/1 (100.00%)
language_results [Dinka, Northeastern]: 2/2 (100.00%)
language_results [Dzongkha]: 160/160 (100.00%)
language_results [Evenki]: 13/13 (100.00%)
language_results [Farsi, Western]: 3/3 (100.00%)
language_results [Fon]: 1/1 (100.00%)
language_results [French (Welche)]: 2/2 (100.00%)
language_results [Fur]: 9/9 (100.00%)
language_results [Ga]: 1/1 (100.00%)
language_results [Gen]: 1/1 (100.00%)
language_results [Gilyak]: 2/2 (100.00%)
language_results [Gujarati]: 240/290 (82.76%)
language_results [Gumuz]: 2/2 (100.00%)
language_results [Hindi]: 110/166 (66.27%)
language_results [Javanese (Javanese)]: 167/488 (34.22%)
language_results [Kabyle]: 8/8 (100.00%)
language_results [Kannada]: 222/236 (94.07%)
language_results [Khmer, Central]: 300/390 (76.92%)
language_results [Khün]: 346/421 (82.19%)
language_results [Lamnso']: 3/3 (100.00%)
language_results [Lao]: 217/217 (100.00%)
language_results [Lingala (tones)]: 8/8 (100.00%)
language_results [Magahi]: 15/22 (68.18%)
language_results [Maithili]: 47/66 (71.21%)
language_results [Malayalam]: 242/382 (63.35%)
language_results [Maldivian]: 209/209 (100.00%)
language_results [Maori (2)]: 6/6 (100.00%)
language_results [Marathi]: 57/103 (55.34%)
language_results [Mazahua Central]: 3/3 (100.00%)
language_results [Mon]: 201/208 (96.63%)
language_results [Mòoré]: 1/1 (100.00%)
language_results [Nanai]: 2/2 (100.00%)
language_results [Navajo]: 4/4 (100.00%)
language_results [Nepali]: 49/71 (69.01%)
language_results [Orok]: 1/1 (100.00%)
language_results [Otomi, Mezquital]: 1/1 (100.00%)
language_results [Panjabi, Eastern]: 239/239 (100.00%)
language_results [Panjabi, Western]: 3/3 (100.00%)
language_results [Pashto, Northern]: 1/1 (100.00%)
language_results [Picard]: 1/1 (100.00%)
language_results [Pular (Adlam)]: 24/24 (100.00%)
language_results [Sanskrit]: 75/156 (48.08%)
language_results [Sanskrit (Grantha)]: 176/237 (74.26%)
language_results [Secoya]: 1/1 (100.00%)
language_results [Seraiki]: 1/1 (100.00%)
language_results [Shan]: 106/106 (100.00%)
language_results [Shipibo-Conibo]: 2/2 (100.00%)
language_results [Sinhala]: 198/198 (100.00%)
language_results [Siona]: 1/1 (100.00%)
language_results [South Azerbaijani]: 6/6 (100.00%)
language_results [Tagalog (Tagalog)]: 16/16 (100.00%)
language_results [Tai Dam]: 120/120 (100.00%)
language_results [Tamang, Eastern]: 5/11 (45.45%)
language_results [Tamazight, Central Atlas]: 5/5 (100.00%)
language_results [Tamil]: 132/132 (100.00%)
language_results [Telugu]: 293/335 (87.46%)
language_results [Tem]: 2/2 (100.00%)
language_results [Thai]: 193/193 (100.00%)
language_results [Thai (2)]: 14/14 (100.00%)
language_results [Tibetan, Central]: 48/48 (100.00%)
language_results [Ticuna]: 13/13 (100.00%)
language_results [Uduk]: 2/2 (100.00%)
language_results [Urdu]: 23/23 (100.00%)
language_results [Urdu (2)]: 1/1 (100.00%)
language_results [Vietnamese]: 42/42 (100.00%)
language_results [Yaneshaʼ]: 10/10 (100.00%)
language_results [Yiddish, Eastern]: 10/10 (100.00%)
language_results [Yoruba]: 8/8 (100.00%)
narrow_results v18.0.0: 5000/5000 (100.00%)
ri_results v18.0.0: 262/262 (100.00%)
sfz_results v18.0.0: 5/5 (100.00%)
sri_results v18.0.0: 26/26 (100.00%)
tofu_results v18.0.0: 0/1086 (0.00%)
unicode_wide_results v18.0.0: 1528/1529 (99.93%)
```

## 口径说明

- 宽字符/emoji 各套（wide/zwj/vs16/vs15/ri/sri/sfz/narrow）是 issue 指定的核查对象，全部近满分；
  `ᅟ`（HANGUL CHOSEONG FILLER）是唯一的 wide 失败——wcwidth 记 2 格、内核记 0 格的经典分歧。
- `language_results`（grapheme 簇宽度）与 `tofu_results` 同样走仿真内核：tofu 的 glyph 覆盖协议在
  无字体管线的 headless 里答「全未覆盖」，pct 不具备渲染含义，只作内核应答行为记录。
- Ghostty 的 `test/ucs-detect.sh` 写的 `--limit-words` 在 ucs-detect 2.3 起更名为 `--limit-graphemes`，
  （旧名只剩读旧 YAML 的别名）；限额数值不变（5000/5000/1000）。
- 原始 JSON：

```json
{
  "ambiguous_width": 1,
  "datetime": "2026-11-18 11:47:45 UTC",
  "environment": {
    "COLORTERM": "truecolor",
    "TERM": "xterm-256color",
    "TERM_PROGRAM": "Zu",
    "TERM_PROGRAM_VERSION": "1.6.2"
  },
  "height": 25,
  "preferred_encoding": "UTF-8",
  "python_version": "3.9.6",
  "seconds_elapsed": 1.3818759999999999,
  "session_arguments": {
    "all": false,
    "limit_category_time": 0,
    "limit_codepoints": 5000,
    "limit_errors": 1000,
    "limit_graphemes": 5000,
    "limit_graphemes_pct": 0,
    "stream": "stderr",
    "timeout_cps": 3.0
  },
  "software_name": "Zu",
  "software_version": "",
  "system": "Darwin",
  "terminal_results": {
    "cell_height": 20,
    "cell_width": 10,
    "color_scheme": "light",
    "colored_underlines": true,
    "decrqcra": true,
    "decrqss": true,
    "decrqss_settings": {
      "decscusr": "2",
      "decstbm": "1;25",
      "sgr": "0"
    },
    "decrqss_truecolor_probe": true,
    "device_attributes": {
      "extensions": [
        22
      ],
      "raw": "\u001b[?65;22c",
      "service_class": 65
    },
    "height": 25,
    "iterm2_features": {
      "features": {},
      "supported": false
    },
    "iterm2_graphics": false,
    "kitty_clipboard_protocol": false,
    "kitty_graphics": true,
    "kitty_keyboard": {
      "disambiguate": true,
      "report_all_keys": true,
      "report_alternates": true,
      "report_events": true,
      "report_text": true,
      "supported_flags": 31
    },
    "kitty_notifications": false,
    "kitty_pointer_shapes": false,
    "kitty_query": false,
    "modes": {
      "1004": {
        "changeable": true,
        "enabled": false,
        "mode_description": "Send FocusIn/FocusOut events",
        "mode_name": "FOCUS_IN_OUT_EVENTS",
        "supported": true,
        "value": 2,
        "value_description": "RESET"
      },
      "1006": {
        "changeable": true,
        "enabled": false,
        "mode_description": "Enable SGR Mouse Mode",
        "mode_name": "MOUSE_EXTENDED_SGR",
        "supported": true,
        "value": 2,
        "value_description": "RESET"
      },
      "2004": {
        "changeable": true,
        "enabled": false,
        "mode_description": "Set bracketed paste mode",
        "mode_name": "BRACKETED_PASTE",
        "supported": true,
        "value": 2,
        "value_description": "RESET"
      },
      "2026": {
        "changeable": true,
        "enabled": false,
        "mode_description": "Synchronized Output",
        "mode_name": "SYNCHRONIZED_OUTPUT",
        "supported": true,
        "value": 2,
        "value_description": "RESET"
      },
      "2027": {
        "changeable": true,
        "enabled": false,
        "mode_description": "Grapheme Clustering",
        "mode_name": "GRAPHEME_CLUSTERING",
        "supported": true,
        "value": 2,
        "value_description": "RESET"
      },
      "2031": {
        "changeable": true,
        "enabled": false,
        "mode_description": "Color palette updates",
        "mode_name": "COLOR_PALETTE_UPDATES",
        "supported": true,
        "value": 2,
        "value_description": "RESET"
      },
      "2048": {
        "changeable": true,
        "enabled": false,
        "mode_description": "In-Band Window Resize Notifications",
        "mode_name": "IN_BAND_WINDOW_RESIZE",
        "supported": true,
        "value": 2,
        "value_description": "RESET"
      },
      "5522": {
        "changeable": false,
        "enabled": false,
        "mode_description": "Bracketed Paste MIME",
        "mode_name": "BRACKETED_PASTE_MIME",
        "supported": false,
        "value": 0,
        "value_description": "NOT_RECOGNIZED"
      }
    },
    "number_of_colors": 16777216,
    "osc52_clipboard": true,
    "osc52_detection": {
      "da1_extension_52": false,
      "xtgettcap_ms": true
    },
    "pixels_height": 500,
    "pixels_width": 800,
    "screen_ratio": "16:10",
    "screen_ratio_name": "WSXGA",
    "sixel": false,
    "software_method": "XTVERSION",
    "software_name": "Zu",
    "styled_underlines": true,
    "tab_stop_width": 8,
    "text_sizing": {
      "scale": false,
      "width": false
    },
    "tofu": {
      "protocol": "glyph",
      "supported": true
    },
    "ttype": "xterm-256color",
    "width": 80,
    "xtgettcap": {
      "capabilities": {
        "AX": "",
        "BD": "\u001b[?2004l",
        "BE": "\u001b[?2004h",
        "E3": "\u001b[3J",
        "Ms": "\u001b]52;%p1%s;%p2%s\u0007",
        "PE": "\u001b[201~",
        "PS": "\u001b[200~",
        "RGB": "8",
        "RV": "\u001b[>c",
        "Rmol": "\u001b[55m",
        "Se": "\u001b[0 q",
        "Setulc": "\u001b[58:2::%p1%{65536}%/%d:%p1%{256}%/%{255}%&%d:%p1%{255}%&%d%;m",
        "Smol": "\u001b[53m",
        "Smulx": "\u001b[4:%p1%dm",
        "Ss": "\u001b[%p1%d q",
        "Su": "",
        "Sync": "\u001b[?2026%?%p1%{1}%-%tl%eh%;",
        "Tc": "",
        "XM": "\u001b[?1006;1000%?%p1%{1}%=%th%el%;",
        "XR": "\u001b[>0q",
        "XT": "",
        "acsc": "++\\,\\,--..00``aaffgghhiijjkkllmmnnooppqqrrssttuuvvwwxxyyzz{{||}}~~",
        "am": "",
        "bce": "",
        "bel": "\u0007",
        "blink": "\u001b[5m",
        "bold": "\u001b[1m",
        "ccc": "",
        "civis": "\u001b[?25l",
        "clear": "\u001b[H\u001b[2J",
        "cnorm": "\u001b[?12l\u001b[?25h",
        "colors": "256",
        "cols": "80",
        "cr": "\r",
        "csr": "\u001b[%i%p1%d;%p2%dr",
        "cub": "\u001b[%p1%dD",
        "cub1": "\b",
        "cud": "\u001b[%p1%dB",
        "cud1": "\n",
        "cuf": "\u001b[%p1%dC",
        "cuf1": "\u001b[C",
        "cup": "\u001b[%i%p1%d;%p2%dH",
        "cuu": "\u001b[%p1%dA",
        "cuu1": "\u001b[A",
        "cvvis": "\u001b[?12;25h",
        "dch": "\u001b[%p1%dP",
        "dch1": "\u001b[P",
        "dim": "\u001b[2m",
        "dl": "\u001b[%p1%dM",
        "dl1": "\u001b[M",
        "dsl": "\u001b]2;\u0007",
        "ech": "\u001b[%p1%dX",
        "ed": "\u001b[J",
        "el": "\u001b[K",
        "el1": "\u001b[1K",
        "fd": "\u001b[?1004l",
        "fe": "\u001b[?1004h",
        "flash": "\u001b[?5h$<100/>\u001b[?5l",
        "fsl": "\u0007",
        "fullkbd": "",
        "home": "\u001b[H",
        "hpa": "\u001b[%i%p1%dG",
        "hs": "",
        "ht": "\t",
        "hts": "\u001bH",
        "ich": "\u001b[%p1%d@",
        "ich1": "\u001b[@",
        "il": "\u001b[%p1%dL",
        "il1": "\u001b[L",
        "ind": "\n",
        "indn": "\u001b[%p1%dS",
        "initc": "\u001b]4;%p1%d;rgb:%p2%{255}%*%{1000}%/%2.2X/%p3%{255}%*%{1000}%/%2.2X/%p4%{255}%*%{1000}%/%2.2X\u001b\\",
        "invis": "\u001b[8m",
        "it": "8",
        "kDC": "\u001b[3;2~",
        "kDC3": "\u001b[3;3~",
        "kDC4": "\u001b[3;4~",
        "kDC5": "\u001b[3;5~",
        "kDC6": "\u001b[3;6~",
        "kDC7": "\u001b[3;7~",
        "kDN": "\u001b[1;2B",
        "kDN3": "\u001b[1;3B",
        "kDN4": "\u001b[1;4B",
        "kDN5": "\u001b[1;5B",
        "kDN6": "\u001b[1;6B",
        "kDN7": "\u001b[1;7B",
        "kEND": "\u001b[1;2F",
        "kEND3": "\u001b[1;3F",
        "kEND4": "\u001b[1;4F",
        "kEND5": "\u001b[1;5F",
        "kEND6": "\u001b[1;6F",
        "kEND7": "\u001b[1;7F",
        "kHOM": "\u001b[1;2H",
        "kHOM3": "\u001b[1;3H",
        "kHOM4": "\u001b[1;4H",
        "kHOM5": "\u001b[1;5H",
        "kHOM6": "\u001b[1;6H",
        "kHOM7": "\u001b[1;7H",
        "kIC": "\u001b[2;2~",
        "kIC3": "\u001b[2;3~",
        "kIC4": "\u001b[2;4~",
        "kIC5": "\u001b[2;5~",
        "kIC6": "\u001b[2;6~",
        "kIC7": "\u001b[2;7~",
        "kLFT": "\u001b[1;2D",
        "kLFT3": "\u001b[1;3D",
        "kLFT4": "\u001b[1;4D",
        "kLFT5": "\u001b[1;5D",
        "kLFT6": "\u001b[1;6D",
        "kLFT7": "\u001b[1;7D",
        "kNXT": "\u001b[6;2~",
        "kNXT3": "\u001b[6;3~",
        "kNXT4": "\u001b[6;4~",
        "kNXT5": "\u001b[6;5~",
        "kNXT6": "\u001b[6;6~",
        "kNXT7": "\u001b[6;7~",
        "kPRV": "\u001b[5;2~",
        "kPRV3": "\u001b[5;3~",
        "kPRV4": "\u001b[5;4~",
        "kPRV5": "\u001b[5;5~",
        "kPRV6": "\u001b[5;6~",
        "kPRV7": "\u001b[5;7~",
        "kRIT": "\u001b[1;2C",
        "kRIT3": "\u001b[1;3C",
        "kRIT4": "\u001b[1;4C",
        "kRIT5": "\u001b[1;5C",
        "kRIT6": "\u001b[1;6C",
        "kRIT7": "\u001b[1;7C",
        "kUP": "\u001b[1;2A",
        "kUP3": "\u001b[1;3A",
        "kUP4": "\u001b[1;4A",
        "kUP5": "\u001b[1;5A",
        "kUP6": "\u001b[1;6A",
        "kUP7": "\u001b[1;7A",
        "kbs": "",
        "kcbt": "\u001b[Z",
        "kcub1": "\u001bOD",
        "kcud1": "\u001bOB",
        "kcuf1": "\u001bOC",
        "kcuu1": "\u001bOA",
        "kdch1": "\u001b[3~",
        "kend": "\u001bOF",
        "kent": "\u001bOM",
        "kf1": "\u001bOP",
        "kf10": "\u001b[21~",
        "kf11": "\u001b[23~",
        "kf12": "\u001b[24~",
        "kf2": "\u001bOQ",
        "kf3": "\u001bOR",
        "kf4": "\u001bOS",
        "kf5": "\u001b[15~",
        "kf6": "\u001b[17~",
        "kf7": "\u001b[18~",
        "kf8": "\u001b[19~",
        "kf9": "\u001b[20~",
        "khome": "\u001bOH",
        "kich1": "\u001b[2~",
        "kind": "\u001b[1;2B",
        "km": "",
        "kmous": "\u001b[<",
        "knp": "\u001b[6~",
        "kpp": "\u001b[5~",
        "kri": "\u001b[1;2A",
        "kxIN": "\u001b[I",
        "kxOUT": "\u001b[O",
        "lines": "24",
        "mc5i": "",
        "mir": "",
        "msgr": "",
        "npc": "",
        "oc": "\u001b]104\u0007",
        "op": "\u001b[39;49m",
        "pairs": "32767",
        "rc": "\u001b8",
        "rep": "%p1%c\u001b[%p2%{1}%-%db",
        "rev": "\u001b[7m",
        "ri": "\u001bM",
        "rin": "\u001b[%p1%dT",
        "ritm": "\u001b[23m",
        "rmacs": "\u001b(B",
        "rmam": "\u001b[?7l",
        "rmcup": "\u001b[?1049l",
        "rmir": "\u001b[4l",
        "rmkx": "\u001b[?1l\u001b>",
        "rmso": "\u001b[27m",
        "rmul": "\u001b[24m",
        "rs1": "\u001b]\u001b\\\u001bc",
        "rv": "\u001b\\[[0-9]+;[0-9]+;[0-9]+c",
        "sc": "\u001b7",
        "setab": "\u001b[%?%p1%{8}%<%t4%p1%d%e%p1%{16}%<%t10%p1%{8}%-%d%e48;5;%p1%d%;m",
        "setaf": "\u001b[%?%p1%{8}%<%t3%p1%d%e%p1%{16}%<%t9%p1%{8}%-%d%e38;5;%p1%d%;m",
        "setrgbb": "\u001b[48:2:%p1%d:%p2%d:%p3%dm",
        "setrgbf": "\u001b[38:2:%p1%d:%p2%d:%p3%dm",
        "sgr": "%?%p9%t\u001b(0%e\u001b(B%;\u001b[0%?%p6%t;1%;%?%p5%t;2%;%?%p2%t;4%;%?%p1%p3%|%t;7%;%?%p4%t;5%;%?%p7%t;8%;m",
        "sgr0": "\u001b(B\u001b[m",
        "sitm": "\u001b[3m",
        "smacs": "\u001b(0",
        "smam": "\u001b[?7h",
        "smcup": "\u001b[?1049h",
        "smir": "\u001b[4h",
        "smkx": "\u001b[?1h\u001b=",
        "smso": "\u001b[7m",
        "smul": "\u001b[4m",
        "tbc": "\u001b[3g",
        "tsl": "\u001b]2;",
        "u6": "\u001b[%i%d;%dR",
        "u7": "\u001b[6n",
        "u8": "\u001b[?%[;0123456789]c",
        "u9": "\u001b[c",
        "vpa": "\u001b[%i%p1%dd",
        "xenl": "",
        "xm": "\u001b[<%i%p3%d;%p1%d;%p2%d;%?%p4%tM%em%;",
        "xr": "\u001bP>\\|[ -~]+a\u001b\\"
      },
      "supported": true
    },
    "xtgettcap-bad-screenleak": false,
    "xtversion-bad-screenleak": false,
    "xtversion_raw": "Zu"
  },
  "test_results": {
    "emoji_vs15_results": {
      "9.0.0": {
        "failed_codepoints": [],
        "n_errors": 0,
        "n_total": 158,
        "pct_success": 100.0
      }
    },
    "emoji_vs16_results": {
      "9.0.0": {
        "failed_codepoints": [],
        "n_errors": 0,
        "n_total": 426,
        "pct_success": 100.0
      }
    },
    "emoji_zwj_results": {
      "18.0.0": {
        "failed_codepoints": [],
        "n_errors": 0,
        "n_total": 1445,
        "pct_success": 100.0
      }
    },
    "language_results": {
      "Aja": {
        "failed": [],
        "n_errors": 0,
        "n_total": 3,
        "pct_success": 100.0
      },
      "Amarakaeri": {
        "failed": [],
        "n_errors": 0,
        "n_total": 6,
        "pct_success": 100.0
      },
      "Arabic, Standard": {
        "failed": [],
        "n_errors": 0,
        "n_total": 8,
        "pct_success": 100.0
      },
      "Assyrian Neo-Aramaic": {
        "failed": [],
        "n_errors": 0,
        "n_total": 8,
        "pct_success": 100.0
      },
      "Baatonum": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Bamun": {
        "failed": [],
        "n_errors": 0,
        "n_total": 17,
        "pct_success": 100.0
      },
      "Belanda Viri": {
        "failed": [],
        "n_errors": 0,
        "n_total": 3,
        "pct_success": 100.0
      },
      "Bengali": {
        "failed": [
          {
            "grapheme_id": "Bengali-2-04",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09bf\\u0982"
          },
          {
            "grapheme_id": "Bengali-2-09",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09cd\\u09a4\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-0c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09cd\\u09b0\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09cd\\u09b7\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-0f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09cd\\u09b7\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-10",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09cd\\u09b7\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-11",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09cd\\u09b7\\u09cd\\u09af"
          },
          {
            "grapheme_id": "Bengali-2-12",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0995\\u09cd\\u09b7\\u09cd\\u09af\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-16",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0996\\u09cd\\u09af\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-1c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0997\\u09cd\\u09b0\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-1d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0997\\u09cd\\u09b0\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0998\\u09c7\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-22",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0999\\u09cd\\u0996\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-24",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0999\\u09cd\\u0997\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0999\\u09cd\\u0997\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-2e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u099a\\u09cd\\u099b\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-2f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u099a\\u09cd\\u099b\\u09be\\u200c"
          },
          {
            "grapheme_id": "Bengali-2-31",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u099a\\u09cd\\u099b\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-3b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u099c\\u09cd\\u099e\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-3e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u099e\\u09cd\\u099a\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-3f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u099e\\u09cd\\u099b\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-42",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u099f\\u09cd\\u09b0\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-49",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a3\\u09cd\\u09a1\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09a4\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-56",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09a4\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-59",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09ac\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-5c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09af\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-5d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09af\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-5e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09af\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-60",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09b0\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-61",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u09b0\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-63",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u200d\\u09aa\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-64",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a4\\u09cd\\u200d\\u09b8\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-6f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a6\\u09cd\\u09a6\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-70",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a6\\u09cd\\u09a6\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-72",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a6\\u09cd\\u09a7\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-73",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a6\\u09cd\\u09a7\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-74",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a6\\u09cd\\u09a7\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-75",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a6\\u09cd\\u09ac\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-79",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a6\\u09cd\\u09b0\\u09cb"
          },
          {
            "grapheme_id": "Bengali-2-7f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a7\\u09cd\\u09af\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-89",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09a4\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-8a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09a4\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-8b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09a4\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-8c",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09a4\\u09cd\\u09b0\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-8d",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09a4\\u09cd\\u09b0\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-8e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09a5\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-90",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09a7\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-94",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09ae\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-97",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09af\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-98",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09a8\\u09cd\\u09af\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-a0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09aa\\u09cd\\u09a4\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-a2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09aa\\u09cd\\u09b0\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-ad",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09ac\\u09cd\\u09a7\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-af",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09ac\\u09cd\\u09af\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-b7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09ad\\u09cd\\u09b0\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-be",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09ae\\u09cd\\u09aa\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-c2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09ae\\u09cd\\u09ae\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-cd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09be\\u0982"
          },
          {
            "grapheme_id": "Bengali-2-d4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u099c\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-d8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09a5\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-d9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09a6\\u09cb"
          },
          {
            "grapheme_id": "Bengali-2-db",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09a7\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-dc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09a8\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-de",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09ac\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-df",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09ac\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-e0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09ac\\u09cb"
          },
          {
            "grapheme_id": "Bengali-2-e1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09ac\\u09cd\\u09af"
          },
          {
            "grapheme_id": "Bengali-2-e4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09ae\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-e6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b0\\u09cd\\u09af\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-ee",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b2\\u09cd\\u09af\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-ef",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b2\\u09cd\\u09af\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-f0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b2\\u09cd\\u09b2\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-f9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b6\\u09cd\\u099a\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-fa",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b6\\u09cd\\u09ac\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-fb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b6\\u09cd\\u09ac\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-fd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b6\\u09cd\\u09af\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-ff",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b6\\u09cd\\u09b0\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-105",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u099f\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-106",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u099f\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-107",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u099f\\u09cd\\u09b0"
          },
          {
            "grapheme_id": "Bengali-2-108",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u099f\\u09cd\\u09b0\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-109",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u099f\\u09cd\\u09b0\\u09c7"
          },
          {
            "grapheme_id": "Bengali-2-10a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u09a0\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-10b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u09a0\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-10c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b7\\u09cd\\u09a0\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-111",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09be\\u0982"
          },
          {
            "grapheme_id": "Bengali-2-119",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09a4\\u09bf"
          },
          {
            "grapheme_id": "Bengali-2-11a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09a4\\u09bf\\u200c"
          },
          {
            "grapheme_id": "Bengali-2-11b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09a4\\u09cd\\u09b0"
          },
          {
            "grapheme_id": "Bengali-2-11d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09a5\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-11e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09a5\\u09cd\\u09af"
          },
          {
            "grapheme_id": "Bengali-2-120",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09ac\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-121",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09ac\\u09c0"
          },
          {
            "grapheme_id": "Bengali-2-123",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09af\\u09be"
          },
          {
            "grapheme_id": "Bengali-2-124",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u09b8\\u09cd\\u09af\\u09c7"
          }
        ],
        "n_errors": 96,
        "n_total": 335,
        "pct_success": 71.34328358208955
      },
      "Bhojpuri": {
        "failed": [
          {
            "grapheme_id": "Bhojpuri-2-06",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0918\\u094d\\u0918\\u093f\\u094d"
          },
          {
            "grapheme_id": "Bhojpuri-2-08",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-0a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-1b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0918\\u094d\\u0915\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-1e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0918\\u094d\\u0930\\u094d\\u0935\\u094d\\u092f"
          },
          {
            "grapheme_id": "Bhojpuri-2-1f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0918\\u094d\\u0932\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0918\\u094d\\u0936\\u094d\\u092f"
          },
          {
            "grapheme_id": "Bhojpuri-2-21",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0918\\u094d\\u0938\\u094d\\u091f"
          },
          {
            "grapheme_id": "Bhojpuri-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091a\\u094d\\u091a\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-26",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091a\\u094d\\u091b\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-2d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091c\\u094d\\u091e\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-3d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-3f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u092f\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-41",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-42",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u093e\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-43",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-4a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0935\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-59",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092a\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-66",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u092e\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-68",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-72",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u091c\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-73",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u091c\\u0940"
          },
          {
            "grapheme_id": "Bhojpuri-2-77",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-78",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0925\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-79",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0926\\u094b"
          },
          {
            "grapheme_id": "Bhojpuri-2-7a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0927\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-7f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u092e\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-81",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-8b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-92",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0935\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-9a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u0935\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-9f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930"
          },
          {
            "grapheme_id": "Bhojpuri-2-a0",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930\\u0940"
          },
          {
            "grapheme_id": "Bhojpuri-2-a9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u0940"
          },
          {
            "grapheme_id": "Bhojpuri-2-ab",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0925\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-ac",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0925\\u093f"
          },
          {
            "grapheme_id": "Bhojpuri-2-ad",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0925\\u0940"
          },
          {
            "grapheme_id": "Bhojpuri-2-ae",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0925\\u094d\\u092f"
          },
          {
            "grapheme_id": "Bhojpuri-2-b1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0935\\u093e"
          },
          {
            "grapheme_id": "Bhojpuri-2-b2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0938\\u093e"
          }
        ],
        "n_errors": 41,
        "n_total": 252,
        "pct_success": 83.73015873015873
      },
      "Bora": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Burmese": {
        "failed": [
          {
            "grapheme_id": "Burmese-2-06",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1000\\u103b\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-0c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1000\\u103c\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1000\\u103c\\u103d\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-16",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1001\\u103b\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-19",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1001\\u103c\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-33",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1015\\u103b\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-37",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1015\\u103c\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1019\\u103c\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-52",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u101c\\u103b\\u1031"
          },
          {
            "grapheme_id": "Burmese-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u101c\\u103b\\u103e\\u1031"
          }
        ],
        "n_errors": 10,
        "n_total": 223,
        "pct_success": 95.51569506726457
      },
      "Catalan (2)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 6,
        "pct_success": 100.0
      },
      "Chakma": {
        "failed": [
          {
            "grapheme_id": "Chakma-2-07",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011107\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011108\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-15",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001110c\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001110e\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-1d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011111\\U00011133\\U00011122\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011116\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-23",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011116\\U00011133\\U00011122\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-28",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011118\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-2f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001111a\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-3d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001111d\\U00011133\\U00011122\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-41",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001111f\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-46",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011121\\U00011133\\U00011120\\U0001112c"
          },
          {
            "grapheme_id": "Chakma-2-4c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011123\\U00011133\\U00011126\\U0001112c"
          }
        ],
        "n_errors": 13,
        "n_total": 225,
        "pct_success": 94.22222222222221
      },
      "Chickasaw": {
        "failed": [],
        "n_errors": 0,
        "n_total": 4,
        "pct_success": 100.0
      },
      "Chinantec, Chiltepec": {
        "failed": [],
        "n_errors": 0,
        "n_total": 6,
        "pct_success": 100.0
      },
      "Dagaare, Southern": {
        "failed": [],
        "n_errors": 0,
        "n_total": 3,
        "pct_success": 100.0
      },
      "Dari": {
        "failed": [],
        "n_errors": 0,
        "n_total": 6,
        "pct_success": 100.0
      },
      "Dendi": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Dinka, Northeastern": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Dzongkha": {
        "failed": [],
        "n_errors": 0,
        "n_total": 160,
        "pct_success": 100.0
      },
      "Evenki": {
        "failed": [],
        "n_errors": 0,
        "n_total": 13,
        "pct_success": 100.0
      },
      "Farsi, Western": {
        "failed": [],
        "n_errors": 0,
        "n_total": 3,
        "pct_success": 100.0
      },
      "Fon": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "French (Welche)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Fur": {
        "failed": [],
        "n_errors": 0,
        "n_total": 9,
        "pct_success": 100.0
      },
      "Ga": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Gen": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Gilyak": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Gujarati": {
        "failed": [
          {
            "grapheme_id": "Gujarati-2-07",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a95\\u0acd\\u0a95\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-08",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a95\\u0acd\\u0a95\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-09",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a95\\u0acd\\u0aa4\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-0c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a95\\u0acd\\u0ab7\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-1d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a9a\\u0acd\\u0a9a\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-1f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a9a\\u0acd\\u0a9b\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-28",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a9c\\u0acd\\u0a9e\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-2a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0a9c\\u0acd\\u0aaf\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-3b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aa4\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-3c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aa4\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-3d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aa4\\u0acd\\u0ab5"
          },
          {
            "grapheme_id": "Gujarati-2-3e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aa4\\u0acd\\u0ab5\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-42",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aaf\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-43",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aaf\\u0abe\\u0a82"
          },
          {
            "grapheme_id": "Gujarati-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aaf\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-46",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0aaf\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-48",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0ab0\\u0ac0"
          },
          {
            "grapheme_id": "Gujarati-2-49",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa4\\u0acd\\u0ab0\\u0acd\\u0aaf"
          },
          {
            "grapheme_id": "Gujarati-2-51",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa6\\u0acd\\u0aa7\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-52",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa6\\u0acd\\u0aa7\\u0abe\\u0a82"
          },
          {
            "grapheme_id": "Gujarati-2-53",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa6\\u0acd\\u0aa7\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa6\\u0acd\\u0ab5\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-5c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa7\\u0acd\\u0aaf\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-64",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa8\\u0acd\\u0aa4\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-66",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa8\\u0acd\\u0aae\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-69",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aa8\\u0acd\\u0aaf\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-71",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aaa\\u0acd\\u0ab0\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-85",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0aae\\u0acd\\u0aaf\\u0abe\\u0a82"
          },
          {
            "grapheme_id": "Gujarati-2-91",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab0\\u0acd\\u0aa4\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-93",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab0\\u0acd\\u0aa5\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-94",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab0\\u0acd\\u0aa6\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-96",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab0\\u0acd\\u0aae\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-99",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab0\\u0acd\\u0aaf\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-9a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab0\\u0acd\\u0aaf\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-ac",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab5\\u0acd\\u0aaf\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-ad",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab5\\u0acd\\u0aaf\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-bb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab7\\u0acd\\u0a9f\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-bc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab7\\u0acd\\u0a9f\\u0acd\\u0ab0"
          },
          {
            "grapheme_id": "Gujarati-2-bd",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab7\\u0acd\\u0a9f\\u0acd\\u0ab0\\u0ac0"
          },
          {
            "grapheme_id": "Gujarati-2-be",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab7\\u0acd\\u0a9f\\u0acd\\u0ab0\\u0acb"
          },
          {
            "grapheme_id": "Gujarati-2-bf",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab7\\u0acd\\u0aa0\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-c9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0aa4\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-ca",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0aa4\\u0ac0"
          },
          {
            "grapheme_id": "Gujarati-2-cb",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0aa4\\u0acd\\u0ab0\\u0ac0"
          },
          {
            "grapheme_id": "Gujarati-2-cc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0aa5\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-cd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0aa5\\u0abf"
          },
          {
            "grapheme_id": "Gujarati-2-cf",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0ab0\\u0ac0"
          },
          {
            "grapheme_id": "Gujarati-2-d1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0ab5\\u0abe"
          },
          {
            "grapheme_id": "Gujarati-2-d2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0ab5\\u0ac0"
          },
          {
            "grapheme_id": "Gujarati-2-d3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ab8\\u0acd\\u0ab8\\u0abe"
          }
        ],
        "n_errors": 50,
        "n_total": 290,
        "pct_success": 82.75862068965517
      },
      "Gumuz": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Hindi": {
        "failed": [
          {
            "grapheme_id": "Hindi-2-01",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0928\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-03",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0930\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-04",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-05",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0916\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-0f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091a\\u094d\\u091a\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-10",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091a\\u094d\\u091b\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-13",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091f\\u094d\\u091f\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0915\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-1c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0924\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-1e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0928\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u092a\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-21",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u092e\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-23",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u0940"
          },
          {
            "grapheme_id": "Hindi-2-27",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0938\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-29",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0918\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-2c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-2d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-2e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u092d\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-2f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0930\\u094b"
          },
          {
            "grapheme_id": "Hindi-2-33",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0927\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-34",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u093f\\u0903"
          },
          {
            "grapheme_id": "Hindi-2-36",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-37",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-38",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930"
          },
          {
            "grapheme_id": "Hindi-2-39",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-3b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0926\\u0940"
          },
          {
            "grapheme_id": "Hindi-2-3d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0927\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-3e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0927\\u0940"
          },
          {
            "grapheme_id": "Hindi-2-3f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0927\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-41",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0928\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-42",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u092e\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-4a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092a\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-4d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092b\\u094d\\u0930\\u093e\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-53",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u092d\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u092e\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-58",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0924\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-5b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-5c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u092f\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-5d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0935\\u094b"
          },
          {
            "grapheme_id": "Hindi-2-62",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u094d\\u0932\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-65",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0935\\u094d\\u092f\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-67",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u091a\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-68",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u092f\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-6a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-6c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u0915\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-6d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u093f"
          },
          {
            "grapheme_id": "Hindi-2-6e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-6f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u0920\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-72",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u092f\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-74",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u093e"
          },
          {
            "grapheme_id": "Hindi-2-75",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u094d\\u0930"
          },
          {
            "grapheme_id": "Hindi-2-76",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u094d\\u0930\\u0940"
          },
          {
            "grapheme_id": "Hindi-2-7a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u092f\\u094b\\u0902"
          },
          {
            "grapheme_id": "Hindi-2-7b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0935\\u0940"
          },
          {
            "grapheme_id": "Hindi-2-85",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u095e\\u094d\\u0924\\u093e"
          }
        ],
        "n_errors": 56,
        "n_total": 166,
        "pct_success": 66.26506024096386
      },
      "Javanese (Javanese)": {
        "failed": [
          {
            "grapheme_id": "Javanese (Javanese)-2-02",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-06",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua98f"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-07",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua98f\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-08",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua98f\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-09",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua98f\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-0a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua994"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua994\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-0c",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua994\\ua9bf"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-0d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua995"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-0f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a0\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-10",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a0\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-11",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a0\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-12",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-13",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a2\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-14",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a2\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-15",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-16",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a4\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-17",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a5"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-18",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a5\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-19",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a5\\ua9bf\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a7"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-1b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a7\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-1c",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a7\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-1d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a9"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-1e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9a9\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-1f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9aa"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-21",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9ae"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-22",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b1"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-23",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b1\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-24",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b1\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b1\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-26",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b1\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-27",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-28",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b2\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-29",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b2\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-2a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b2\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-2b",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b2\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-2c",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua98f\\ua9c0\\ua9b2\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-2e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua992\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-30",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua992\\ua9bf\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-31",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua992\\ua9c0\\ua992"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-34",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua994\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-36",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua994\\ua9c0\\ua992\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-37",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua994\\ua9c0\\ua992\\ua9bf\\ua9bc\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-38",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua994\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-39",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua994\\ua9c0\\ua9ad\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-3a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua994\\ua9c0\\ua9ad\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-3b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua994\\ua9c0\\ua9ad\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-3d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua995\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-40",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua997\\ua9bf\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-41",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99a\\ua9c0\\ua995"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-42",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99a\\ua9c0\\ua995\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-43",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99a\\ua9c0\\ua997"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99a\\ua9c0\\ua997\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-45",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99a\\ua9c0\\ua997\\ua9b8\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-46",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99a\\ua9c0\\ua997\\ua9b8\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-49",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99d\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-4a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua99d\\ua9ba\\ua9b4\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-4d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9ba\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-4e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-52",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua98f\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-53",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua98f\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-54",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua992"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua994\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-56",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua99a"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-57",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-58",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a0\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-59",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a0\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-5a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a0\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-5b",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a0\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-5c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-5d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a4\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-5e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a9"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-5f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9a9\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-60",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-61",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9ad\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-62",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b1"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-63",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b1\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-64",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b1\\ua9b6\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-65",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b1\\ua9be"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-66",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b1\\ua9c0\\ua9ae"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-67",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-68",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b2\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-69",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a0\\ua9c0\\ua9b2\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-6c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-6f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9c0\\ua98f"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-70",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9c0\\ua9a0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-71",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9c0\\ua9a0\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-72",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9c0\\ua9a2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-73",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9c0\\ua9a5"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-74",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9c0\\ua9a9\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-75",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a2\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-77",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9ba\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-78",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-79",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua98f"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-7a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua98f\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-7b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua98f\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-7c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua98f\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-7d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua992"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-7e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-7f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-80",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-81",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-82",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994\\ua9b8\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-83",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-84",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-85",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua994\\ua9bf\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-86",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua997"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-87",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua997\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-88",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua997\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-89",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99a\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-8a",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99b\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-8b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99b\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-8c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-8d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-8e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-8f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-90",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d\\ua9b8\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-91",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d\\ua9ba\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-92",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d\\ua9ba\\ua9b4\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-93",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua99d\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-94",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-95",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-96",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-97",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-98",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-99",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua9b8\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-9a",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-9b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-9c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua9bc\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-9d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a0\\ua9bd"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-9e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-9f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a2\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a2\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a2\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a2\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a3",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a2\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a2\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a4\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a4\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a8",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a4\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-a9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a4\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-aa",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ab",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ac",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5\\ua9b3\\ua9ba\\ua9b4\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ad",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ae",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-af",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b0",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5\\ua9bf"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b1",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a5\\ua9bf\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a7"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a7\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a7\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a7\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b6",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a7\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b7",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a7\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a7\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-b9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a9"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ba",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a9\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-bb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a9\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-bc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a9\\ua9b8\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-bd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9a9\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-be",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-bf",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ad\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ad\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ae"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ae\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ae\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ae\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9ae\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c8",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-c9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ca",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-cb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-cc",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-cd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b1\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ce",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-cf",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b2\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-d0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b2\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-d1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b2\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-d2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b2\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-d3",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a4\\ua9c0\\ua9b2\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-d6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-d8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9bf\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-da",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9bf\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-db",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua98f"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-dc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua98f\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-dd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-de",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a0\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-df",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a2\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a4\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a5"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a5\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e4",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a5\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e5",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a7\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a9"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9a9\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e8",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9ab\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-e9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ea",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9ad\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-eb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9b1"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ec",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9b1\\ua9b6\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ed",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9b1\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ee",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a5\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9ba\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9c0\\ua98f"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9c0\\ua9a0\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9c0\\ua9a5"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9c0\\ua9a7"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f7",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9c0\\ua9a7\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-f9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a7\\ua9c0\\ua9b2\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-fc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9ba\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-fd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-ff",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9bf\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-100",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9bf\\ua9b6\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-101",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua98f\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-102",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua994\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-103",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a0\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-104",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a0\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-105",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a4\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-106",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a5"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-107",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a5\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-108",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a5\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-109",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a5\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-10a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-10b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-10c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-10d",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-10e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-10f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-110",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua9b8\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-111",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-112",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua9ba\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-113",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua9bc\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-114",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a7\\ua9be\\ua9b8\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-115",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a9"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-116",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9a9\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-117",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9ab"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-118",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9ab\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-119",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-11a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9a9\\ua9c0\\ua9b2\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-11d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9aa\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-120",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ab\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-125",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9ba\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-126",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-127",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9ba\\ua9b4\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-128",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua98f\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-129",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua99a\\ua9bc\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-12a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9a0\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-12b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9a7\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-12c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9a9\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-12d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-12e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9ad\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-12f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9ad\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-130",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9ad\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-131",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9ae"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-132",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b1"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-133",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b1\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-134",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b1\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-135",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b1\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-136",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-137",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b2\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-138",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b2\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-139",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ad\\ua9c0\\ua9b2\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-13e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ae\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-13f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ae\\ua9ba\\ua9b4\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-140",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ae\\ua9ba\\ua9b4\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-141",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9ae\\ua9bf\\ua9b8\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-144",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-147",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9bf\\ua983"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-148",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua98f"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-149",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua98f\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-14a",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua98f\\ua9bf\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-14b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua992"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-14c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua994\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-14d",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua994\\ua9bf"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-14e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua99b\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-14f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-150",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a0\\ua9bf"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-151",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a2\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-152",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a2\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-153",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a2\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-154",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a5"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-155",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a7"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-156",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a7\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-157",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a9"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-158",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a9\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-159",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a9\\ua9bc"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-15a",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9a9\\ua9bf"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-15b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9ad"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-15c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9ae"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-15d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b1"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-15e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b1\\ua982"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-15f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b1\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-160",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b1\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-161",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b1\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-162",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b1\\ua9ba"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-163",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b2"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-164",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b2\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-165",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b2\\ua9b6"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-166",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b2\\ua9b6\\ua981"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-167",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b1\\ua9c0\\ua9b2\\ua9b8"
          },
          {
            "grapheme_id": "Javanese (Javanese)-2-169",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\ua9b2\\ua9ba\\ua9b4"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-08",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua98f\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-2c",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9a0\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-32",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9a2\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-3c",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9a4\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-3f",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9a5\\ua9b3\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-45",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9a5\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-4b",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9a7\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-54",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9a9\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-65",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9ad\\ua9c0"
          },
          {
            "grapheme_id": "Javanese (Javanese)-1-76",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\ua9b1\\ua9c0"
          }
        ],
        "n_errors": 321,
        "n_total": 488,
        "pct_success": 34.22131147540984
      },
      "Kabyle": {
        "failed": [],
        "n_errors": 0,
        "n_total": 8,
        "pct_success": 100.0
      },
      "Kannada": {
        "failed": [
          {
            "grapheme_id": "Kannada-2-06",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c95\\u0cbe\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-0a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c95\\u0cc1\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-11",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c95\\u0cca\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-12",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c96\\u0cbe\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-14",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c97\\u0cbe\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c97\\u0cca\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-23",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c9f\\u0cc1\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-45",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0ca8\\u0cbe\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-65",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0caf\\u0cc1\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-6d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0cb0\\u0cbe\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-84",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0cb5\\u0cc1\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-8c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0cb6\\u0cbe\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-93",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0cb8\\u0cbe\\u0c82"
          },
          {
            "grapheme_id": "Kannada-2-9b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0cb9\\u0cca\\u0c82"
          }
        ],
        "n_errors": 14,
        "n_total": 236,
        "pct_success": 94.0677966101695
      },
      "Khmer, Central": {
        "failed": [
          {
            "grapheme_id": "Khmer, Central-2-07",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1780\\u17d2\\u178a\\u17c5"
          },
          {
            "grapheme_id": "Khmer, Central-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1780\\u17d2\\u179a\\u17c4"
          },
          {
            "grapheme_id": "Khmer, Central-2-0d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1780\\u17d2\\u179f\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-10",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1781\\u17d2\\u1787\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-12",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1781\\u17d2\\u179b\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-19",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1782\\u17d2\\u1793\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1782\\u17d2\\u1798\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-1c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1782\\u17d2\\u179a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-1d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1782\\u17d2\\u179a\\u17b9\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-26",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1784\\u17d2\\u1780\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-2c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1784\\u17d2\\u179a\\u17c0"
          },
          {
            "grapheme_id": "Khmer, Central-2-2d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1784\\u17d2\\u17a0\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-35",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1785\\u17d2\\u1785\\u17c1"
          },
          {
            "grapheme_id": "Khmer, Central-2-36",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1785\\u17d2\\u1794\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-38",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1786\\u17d2\\u1793\\u17b6\\u17c6"
          },
          {
            "grapheme_id": "Khmer, Central-2-39",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1786\\u17d2\\u1793\\u17c4"
          },
          {
            "grapheme_id": "Khmer, Central-2-3b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1786\\u17d2\\u179b\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-3f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1787\\u17d2\\u1787\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-40",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1787\\u17d2\\u1789\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-43",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1787\\u17d2\\u179a\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1787\\u17d2\\u179a\\u17c0"
          },
          {
            "grapheme_id": "Khmer, Central-2-45",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1787\\u17d2\\u179a\\u17c2"
          },
          {
            "grapheme_id": "Khmer, Central-2-47",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1788\\u17d2\\u1798\\u17c4\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-4a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1789\\u17d2\\u1787\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-4c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1789\\u17d2\\u1789\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-4d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1789\\u17d2\\u1789\\u17c8"
          },
          {
            "grapheme_id": "Khmer, Central-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u178a\\u17d2\\u178b\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-5c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u178e\\u17c4\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-5e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u178e\\u17d2\\u178a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-5f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u178e\\u17d2\\u178a\\u17bb\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-61",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u178e\\u17d2\\u178e\\u17c4\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-6b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u178f\\u17d2\\u179a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-71",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1790\\u17d2\\u1784\\u17c3"
          },
          {
            "grapheme_id": "Khmer, Central-2-72",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1790\\u17d2\\u1793\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-75",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1790\\u17d2\\u179b\\u17c3"
          },
          {
            "grapheme_id": "Khmer, Central-2-7c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1791\\u17c4\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-80",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1791\\u17d2\\u1799\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-84",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1792\\u17d2\\u1793\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-86",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1792\\u17d2\\u1799\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-87",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1792\\u17d2\\u1799\\u17c4"
          },
          {
            "grapheme_id": "Khmer, Central-2-88",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1792\\u17d2\\u179c\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-8c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17c1\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-8e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17c4\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-93",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17d2\\u1790\\u17c2"
          },
          {
            "grapheme_id": "Khmer, Central-2-94",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17d2\\u1790\\u17c4"
          },
          {
            "grapheme_id": "Khmer, Central-2-95",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17d2\\u1791\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-96",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17d2\\u1791\\u17c8"
          },
          {
            "grapheme_id": "Khmer, Central-2-9a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17d2\\u1799\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-9b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1793\\u17d2\\u179b\\u17c2"
          },
          {
            "grapheme_id": "Khmer, Central-2-a1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1794\\u17c4\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-a6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1794\\u17d2\\u178a\\u17c1"
          },
          {
            "grapheme_id": "Khmer, Central-2-aa",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1794\\u17d2\\u179a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-ad",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1794\\u17d2\\u179a\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-ae",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1794\\u17d2\\u179a\\u17c2"
          },
          {
            "grapheme_id": "Khmer, Central-2-b1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u178a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-b2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u1791\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-b4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u1791\\u17c1"
          },
          {
            "grapheme_id": "Khmer, Central-2-b5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u1793\\u17c2"
          },
          {
            "grapheme_id": "Khmer, Central-2-b6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u179b\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-b9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u179f\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-ba",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u179f\\u17c1"
          },
          {
            "grapheme_id": "Khmer, Central-2-bb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1795\\u17d2\\u179f\\u17c3"
          },
          {
            "grapheme_id": "Khmer, Central-2-bf",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1796\\u17c4\\u17c7"
          },
          {
            "grapheme_id": "Khmer, Central-2-c1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1796\\u17d2\\u1799\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-c4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1796\\u17d2\\u179a\\u17c0"
          },
          {
            "grapheme_id": "Khmer, Central-2-c5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1796\\u17d2\\u179a\\u17c3"
          },
          {
            "grapheme_id": "Khmer, Central-2-d0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u1784\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-d1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u1785\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-d2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u178a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-d3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u178a\\u17c2"
          },
          {
            "grapheme_id": "Khmer, Central-2-d4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u1793\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-d5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u1793\\u17c1"
          },
          {
            "grapheme_id": "Khmer, Central-2-d9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u1797\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-dc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u179a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-df",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u179a\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-e0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u179a\\u17c1"
          },
          {
            "grapheme_id": "Khmer, Central-2-e1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u179b\\u17c0"
          },
          {
            "grapheme_id": "Khmer, Central-2-e2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1798\\u17d2\\u179b\\u17c3"
          },
          {
            "grapheme_id": "Khmer, Central-2-f6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179b\\u17d2\\u1794\\u17c8"
          },
          {
            "grapheme_id": "Khmer, Central-2-f7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179b\\u17d2\\u1798\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-ff",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u1782\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-101",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u178a\\u17d2\\u179a\\u17b8"
          },
          {
            "grapheme_id": "Khmer, Central-2-102",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u178f\\u17d2\\u179a"
          },
          {
            "grapheme_id": "Khmer, Central-2-103",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u1790\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-106",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u1793\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-107",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u1798\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-108",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u1798\\u17be"
          },
          {
            "grapheme_id": "Khmer, Central-2-10a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u179a\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-10d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u179b\\u17b6"
          },
          {
            "grapheme_id": "Khmer, Central-2-10e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u179f\\u17d2\\u179c\\u17c2"
          }
        ],
        "n_errors": 90,
        "n_total": 390,
        "pct_success": 76.92307692307693
      },
      "Khün": {
        "failed": [
          {
            "grapheme_id": "Khün-2-0d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a20\\u1a6e\\u1a60\\u1a2f\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-11",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a20\\u1a6f\\u1a60\\u1a2f"
          },
          {
            "grapheme_id": "Khün-2-12",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a20\\u1a6f\\u1a60\\u1a36\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-1c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a21\\u1a6e\\u1a60\\u1a32"
          },
          {
            "grapheme_id": "Khün-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a21\\u1a6f\\u1a60\\u1a20"
          },
          {
            "grapheme_id": "Khün-2-21",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a21\\u1a6f\\u1a60\\u1a26"
          },
          {
            "grapheme_id": "Khün-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a23\\u1a55\\u1a60\\u1a4b"
          },
          {
            "grapheme_id": "Khün-2-26",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a23\\u1a55\\u1a6e\\u1a60"
          },
          {
            "grapheme_id": "Khün-2-27",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a23\\u1a55\\u1a6e\\u1a60\\u1a26\\u1a68\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-32",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a23\\u1a6f\\u1a60\\u1a36\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-33",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a23\\u1a6f\\u1a60\\u1a45"
          },
          {
            "grapheme_id": "Khün-2-40",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a27\\u1a6e\\u1a60\\u1a37"
          },
          {
            "grapheme_id": "Khün-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a27\\u1a71\\u1a60\\u1a3f"
          },
          {
            "grapheme_id": "Khün-2-4a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a29\\u1a6e\\u1a60\\u1a4b\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-4b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a29\\u1a6e\\u1a60\\u1a4b\\u1a68\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-4c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a29\\u1a6e\\u1a60\\u1a4b\\u1a68\\u1a76"
          },
          {
            "grapheme_id": "Khün-2-55",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a2f\\u1a60\\u1a45\\u1a60\\u1a3f\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-56",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a2f\\u1a62\\u1a60\\u1a45\\u1a60\\u1a3f"
          },
          {
            "grapheme_id": "Khün-2-59",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a2f\\u1a6f\\u1a60\\u1a26"
          },
          {
            "grapheme_id": "Khün-2-5a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a2f\\u1a6f\\u1a60\\u1a36"
          },
          {
            "grapheme_id": "Khün-2-5c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a2f\\u1a70\\u1a60\\u1a3f"
          },
          {
            "grapheme_id": "Khün-2-6e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a6e\\u1a60\\u1a20"
          },
          {
            "grapheme_id": "Khün-2-6f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a6e\\u1a60\\u1a26"
          },
          {
            "grapheme_id": "Khün-2-70",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a6e\\u1a60\\u1a3e"
          },
          {
            "grapheme_id": "Khün-2-71",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a6e\\u1a60\\u1a3e\\u1a68\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-73",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a6f\\u1a60\\u1a20"
          },
          {
            "grapheme_id": "Khün-2-74",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a6f\\u1a60\\u1a26\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-75",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a6f\\u1a60\\u1a3e\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-79",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a32\\u1a71\\u1a60\\u1a3f"
          },
          {
            "grapheme_id": "Khün-2-7f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a33\\u1a6e\\u1a60\\u1a36\\u1a68\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-82",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a33\\u1a6f\\u1a60\\u1a26\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-83",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a33\\u1a6f\\u1a60\\u1a3e"
          },
          {
            "grapheme_id": "Khün-2-8c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a34\\u1a6e\\u1a60\\u1a48"
          },
          {
            "grapheme_id": "Khün-2-8d",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a34\\u1a6e\\u1a60\\u1a48\\u1a71"
          },
          {
            "grapheme_id": "Khün-2-91",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a34\\u1a6f\\u1a60\\u1a36"
          },
          {
            "grapheme_id": "Khün-2-94",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a34\\u1a70\\u1a60\\u1a48"
          },
          {
            "grapheme_id": "Khün-2-9d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a36\\u1a6f\\u1a60\\u1a36"
          },
          {
            "grapheme_id": "Khün-2-a9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a37\\u1a6e\\u1a60\\u1a26\\u1a68\\u1a76"
          },
          {
            "grapheme_id": "Khün-2-af",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a38\\u1a6e\\u1a60\\u1a26\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-b0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a38\\u1a6e\\u1a60\\u1a36"
          },
          {
            "grapheme_id": "Khün-2-b9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a39\\u1a6e\\u1a68\\u1a60\\u1a3f"
          },
          {
            "grapheme_id": "Khün-2-bb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3b\\u1a55\\u1a60\\u1a4b\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-c2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3b\\u1a6e\\u1a60\\u1a4b\\u1a68\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-c5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3d\\u1a71\\u1a60\\u1a3f"
          },
          {
            "grapheme_id": "Khün-2-cc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3e\\u1a6e\\u1a60\\u1a20\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-cd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3e\\u1a6e\\u1a60\\u1a26\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-ce",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3e\\u1a6e\\u1a60\\u1a4b\\u1a68\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-d9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3f\\u1a6e\\u1a60\\u1a36"
          },
          {
            "grapheme_id": "Khün-2-da",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a3f\\u1a6e\\u1a60\\u1a3e\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-e7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a41\\u1a6e\\u1a60\\u1a26\\u1a68\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-e8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a41\\u1a6e\\u1a60\\u1a27"
          },
          {
            "grapheme_id": "Khün-2-e9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a41\\u1a6e\\u1a60\\u1a36\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-eb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a41\\u1a6e\\u1a68\\u1a60\\u1a2c"
          },
          {
            "grapheme_id": "Khün-2-ed",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a41\\u1a6f\\u1a60\\u1a26"
          },
          {
            "grapheme_id": "Khün-2-f3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a43\\u1a6e\\u1a60\\u1a20\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-f4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a43\\u1a6e\\u1a60\\u1a26\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-f7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a43\\u1a70\\u1a60\\u1a20"
          },
          {
            "grapheme_id": "Khün-2-fe",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a45\\u1a6e\\u1a60\\u1a36"
          },
          {
            "grapheme_id": "Khün-2-ff",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a45\\u1a6e\\u1a60\\u1a36\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-10f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a48\\u1a6e\\u1a60\\u1a48"
          },
          {
            "grapheme_id": "Khün-2-111",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a48\\u1a6f\\u1a60\\u1a45"
          },
          {
            "grapheme_id": "Khün-2-114",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a48\\u1a71\\u1a60\\u1a3f"
          },
          {
            "grapheme_id": "Khün-2-120",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a60\\u1a3f\\u1a62\\u1a60\\u1a4b"
          },
          {
            "grapheme_id": "Khün-2-126",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6e\\u1a60\\u1a26\\u1a62\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-127",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6e\\u1a60\\u1a2f"
          },
          {
            "grapheme_id": "Khün-2-128",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6e\\u1a60\\u1a32\\u1a69"
          },
          {
            "grapheme_id": "Khün-2-129",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6e\\u1a60\\u1a36\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-12a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6e\\u1a60\\u1a3e\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-12b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6e\\u1a60\\u1a3e\\u1a68\\u1a68"
          },
          {
            "grapheme_id": "Khün-2-12d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6f\\u1a60\\u1a26\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-12e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6f\\u1a60\\u1a36\\u1a62"
          },
          {
            "grapheme_id": "Khün-2-12f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a6f\\u1a60\\u1a3e"
          },
          {
            "grapheme_id": "Khün-2-132",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a71\\u1a60\\u1a3e\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-133",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a49\\u1a71\\u1a60\\u1a3f\\u1a75"
          },
          {
            "grapheme_id": "Khün-2-13e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1a63\\u1a60\\u1a32\\u1a71"
          }
        ],
        "n_errors": 75,
        "n_total": 421,
        "pct_success": 82.18527315914488
      },
      "Lamnso'": {
        "failed": [],
        "n_errors": 0,
        "n_total": 3,
        "pct_success": 100.0
      },
      "Lao": {
        "failed": [],
        "n_errors": 0,
        "n_total": 217,
        "pct_success": 100.0
      },
      "Lingala (tones)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 8,
        "pct_success": 100.0
      },
      "Magahi": {
        "failed": [
          {
            "grapheme_id": "Magahi-2-01",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u094d\\u0923"
          },
          {
            "grapheme_id": "Magahi-2-05",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091f\\u094d\\u091f\\u0940"
          },
          {
            "grapheme_id": "Magahi-2-06",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091f\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Magahi-2-09",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u093e\\u093f"
          },
          {
            "grapheme_id": "Magahi-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u093e\\u0902"
          },
          {
            "grapheme_id": "Magahi-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0924\\u094d\\u0924"
          },
          {
            "grapheme_id": "Magahi-2-10",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u0920\\u093e"
          }
        ],
        "n_errors": 7,
        "n_total": 22,
        "pct_success": 68.18181818181817
      },
      "Maithili": {
        "failed": [
          {
            "grapheme_id": "Maithili-2-02",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u094d\\u092f"
          },
          {
            "grapheme_id": "Maithili-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0924\\u094d\\u0935"
          },
          {
            "grapheme_id": "Maithili-2-0c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0928\\u0940"
          },
          {
            "grapheme_id": "Maithili-2-0d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u092a\\u0940"
          },
          {
            "grapheme_id": "Maithili-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u094d\\u0924"
          },
          {
            "grapheme_id": "Maithili-2-0f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0918\\u094b"
          },
          {
            "grapheme_id": "Maithili-2-13",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u0903"
          },
          {
            "grapheme_id": "Maithili-2-14",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u093e"
          },
          {
            "grapheme_id": "Maithili-2-15",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u093f"
          },
          {
            "grapheme_id": "Maithili-2-18",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092b\\u094d\\u0924\\u093e"
          },
          {
            "grapheme_id": "Maithili-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092c\\u094d\\u0927\\u093f"
          },
          {
            "grapheme_id": "Maithili-2-1c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092d\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Maithili-2-1f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u092a\\u094d\\u0930"
          },
          {
            "grapheme_id": "Maithili-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0915\\u093f"
          },
          {
            "grapheme_id": "Maithili-2-21",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u092c\\u093e"
          },
          {
            "grapheme_id": "Maithili-2-22",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u092e\\u093e"
          },
          {
            "grapheme_id": "Maithili-2-23",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0935\\u093e"
          },
          {
            "grapheme_id": "Maithili-2-24",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u094d\\u092a\\u093f"
          },
          {
            "grapheme_id": "Maithili-2-27",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u092f\\u093f"
          }
        ],
        "n_errors": 19,
        "n_total": 66,
        "pct_success": 71.21212121212122
      },
      "Malayalam": {
        "failed": [
          {
            "grapheme_id": "Malayalam-2-09",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d15\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-0a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d15\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-0c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d15\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-0d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d15\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d15\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-0f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d15\\u0d4a"
          },
          {
            "grapheme_id": "Malayalam-2-10",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d15\\u0d4b"
          },
          {
            "grapheme_id": "Malayalam-2-12",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d24\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-14",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d2f\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-18",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d37\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-19",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d37\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d15\\u0d4d\\u0d37\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-1b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d16\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-1f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d17\\u0d4d\\u0d17\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d17\\u0d4d\\u0d26\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-22",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d17\\u0d4d\\u0d2f\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d19\\u0d4d\\u0d15\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-26",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d19\\u0d4d\\u0d15\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-27",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d19\\u0d4d\\u0d15\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-29",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d19\\u0d4d\\u0d19\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-30",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1a\\u0d4d\\u0d1a\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-32",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1a\\u0d4d\\u0d1a\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-33",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1a\\u0d4d\\u0d1a\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-34",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1a\\u0d4d\\u0d1a\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-39",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1c\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-3c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1e\\u0d4d\\u0d1e\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-3d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1e\\u0d4d\\u0d1e\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1f\\u0d4d\\u0d1f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-45",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1f\\u0d4d\\u0d1f\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-47",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d1f\\u0d4d\\u0d1f\\u0d4b"
          },
          {
            "grapheme_id": "Malayalam-2-4e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d23\\u0d4d\\u0d1f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-4f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d23\\u0d4d\\u0d1f\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-51",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d23\\u0d4d\\u0d1f\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-52",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d23\\u0d4d\\u0d1f\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-60",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d24\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-61",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d24\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-63",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d24\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-64",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d24\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-65",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d24\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-66",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d24\\u0d4b"
          },
          {
            "grapheme_id": "Malayalam-2-69",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d28\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-6a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d28\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-6c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-6d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d2f\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-70",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d24\\u0d4d\\u0d35\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-77",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d26\\u0d4d\\u0d27\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-79",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d26\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-86",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d24\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-87",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d24\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-88",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d24\\u0d4d\\u0d30"
          },
          {
            "grapheme_id": "Malayalam-2-89",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d24\\u0d4d\\u0d30\\u0d4d\\u0d2f"
          },
          {
            "grapheme_id": "Malayalam-2-8a",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d24\\u0d4d\\u0d30\\u0d4d\\u0d2f\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-8e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d27\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-90",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d28\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-91",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d28\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-92",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d28\\u0d40"
          },
          {
            "grapheme_id": "Malayalam-2-94",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d28\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-95",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d28\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-96",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d28\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-97",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d28\\u0d4b"
          },
          {
            "grapheme_id": "Malayalam-2-9a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d2e\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-9e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d2f\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-9f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-a0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d2f\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-a1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d2f\\u0d4b"
          },
          {
            "grapheme_id": "Malayalam-2-a2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u0d31\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-a4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d28\\u0d4d\\u200d\\u0d2a\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-ae",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2a\\u0d4d\\u0d2a\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-b0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2a\\u0d4d\\u0d2a\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-b1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2a\\u0d4d\\u0d2a\\u0d4b"
          },
          {
            "grapheme_id": "Malayalam-2-b4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2a\\u0d4d\\u0d30\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-b8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2c\\u0d4d\\u0d32\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-bd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2d\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-be",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2d\\u0d4d\\u0d30\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-c8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2e\\u0d4d\\u0d2a\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-c9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2e\\u0d4d\\u0d2a\\u0d4d\\u0d30"
          },
          {
            "grapheme_id": "Malayalam-2-cb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2e\\u0d4d\\u0d2e\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-d3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2f\\u0d4d\\u0d15\\u0d4d\\u0d15\\u0d41"
          },
          {
            "grapheme_id": "Malayalam-2-d4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2f\\u0d4d\\u0d24\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-d7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2f\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-d8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d2f\\u0d4d\\u0d2f\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-e2",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u0d2f\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-e3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d41"
          },
          {
            "grapheme_id": "Malayalam-2-e4",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-e5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d4d\\u200c"
          },
          {
            "grapheme_id": "Malayalam-2-e6",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d17\\u0d4d\\u0d17\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-e7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d1a\\u0d4d\\u0d1a"
          },
          {
            "grapheme_id": "Malayalam-2-e8",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d23\\u0d4d\\u0d23"
          },
          {
            "grapheme_id": "Malayalam-2-e9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d24\\u0d4d\\u0d24"
          },
          {
            "grapheme_id": "Malayalam-2-ea",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d24\\u0d4d\\u0d24\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-eb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d24\\u0d4d\\u0d24\\u0d41"
          },
          {
            "grapheme_id": "Malayalam-2-ec",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d24\\u0d4d\\u0d24\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-ed",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d26\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-ee",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d26\\u0d4d\\u0d26"
          },
          {
            "grapheme_id": "Malayalam-2-ef",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d2a\\u0d4d\\u0d2a\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-f2",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d2e\\u0d4d\\u0d2e\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-f3",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d30\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-f4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d35\\u0d4d\\u0d35"
          },
          {
            "grapheme_id": "Malayalam-2-f6",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d30\\u0d4d\\u200d\\u0d39\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-fb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d31\\u0d4d\\u0d31\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-fd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d31\\u0d4d\\u0d31\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-106",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-108",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u0d32\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-109",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u0d32\\u0d3e\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-10a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u0d32\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-10b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u200d\\u0d15\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-10d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u200d\\u0d15\\u0d47"
          },
          {
            "grapheme_id": "Malayalam-2-10f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u200d\\u0d28\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-110",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d32\\u0d4d\\u200d\\u0d2a\\u0d4d\\u0d2a"
          },
          {
            "grapheme_id": "Malayalam-2-119",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u0d33\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-11a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u0d33\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-11c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u200d\\u0d15\\u0d4a"
          },
          {
            "grapheme_id": "Malayalam-2-11d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15"
          },
          {
            "grapheme_id": "Malayalam-2-11e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-11f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d41"
          },
          {
            "grapheme_id": "Malayalam-2-120",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-121",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d46"
          },
          {
            "grapheme_id": "Malayalam-2-122",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d33\\u0d4d\\u200d\\u0d15\\u0d4d\\u0d15\\u0d4d\\u200c"
          },
          {
            "grapheme_id": "Malayalam-2-12c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d35\\u0d4d\\u0d2f\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-12d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d35\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-135",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d36\\u0d4d\\u0d35\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-139",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d37\\u0d4d\\u0d1f\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-13a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d37\\u0d4d\\u0d1f\\u0d4d\\u0d30"
          },
          {
            "grapheme_id": "Malayalam-2-13b",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d37\\u0d4d\\u0d1f\\u0d4d\\u0d30\\u0d40"
          },
          {
            "grapheme_id": "Malayalam-2-13e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d37\\u0d4d\\u0d2f\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-141",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d3e\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-144",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d15\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-146",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d24\\u0d4d\\u0d30\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-147",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d24\\u0d4d\\u0d30\\u0d40"
          },
          {
            "grapheme_id": "Malayalam-2-149",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d25\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-14a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d25\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-14c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d31\\u0d4d\\u0d31\\u0d4d\\u200c"
          },
          {
            "grapheme_id": "Malayalam-2-14e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d35\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-14f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d35\\u0d40"
          },
          {
            "grapheme_id": "Malayalam-2-151",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d38\\u0d3e"
          },
          {
            "grapheme_id": "Malayalam-2-152",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d38\\u0d3f"
          },
          {
            "grapheme_id": "Malayalam-2-153",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d38\\u0d41\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-154",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d38\\u0d4d\\u0d38\\u0d4b"
          },
          {
            "grapheme_id": "Malayalam-2-158",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d39\\u0d3f\\u0d02"
          },
          {
            "grapheme_id": "Malayalam-2-159",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0d7b\\u0d4d\\u0d31\\u0d46"
          }
        ],
        "n_errors": 140,
        "n_total": 382,
        "pct_success": 63.35078534031413
      },
      "Maldivian": {
        "failed": [],
        "n_errors": 0,
        "n_total": 209,
        "pct_success": 100.0
      },
      "Maori (2)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 6,
        "pct_success": 100.0
      },
      "Marathi": {
        "failed": [
          {
            "grapheme_id": "Marathi-2-00",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0915\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-01",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0924\\u0940"
          },
          {
            "grapheme_id": "Marathi-2-02",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0924\\u0940\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-04",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-08",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091a\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-09",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091a\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091c\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-0c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091c\\u094d\\u092f\\u093e\\u200c"
          },
          {
            "grapheme_id": "Marathi-2-10",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091f\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-14",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0923\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-15",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0923\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-17",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0924\\u094d\\u0935\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-18",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0924\\u094d\\u0935\\u0947"
          },
          {
            "grapheme_id": "Marathi-2-1a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-1b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u094d\\u092f"
          },
          {
            "grapheme_id": "Marathi-2-1c",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-1d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0930\\u094d\\u092f\\u0947"
          },
          {
            "grapheme_id": "Marathi-2-1e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0935\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-1f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0935\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-22",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0926\\u093f"
          },
          {
            "grapheme_id": "Marathi-2-23",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0926\\u0940"
          },
          {
            "grapheme_id": "Marathi-2-24",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u093f\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u0940"
          },
          {
            "grapheme_id": "Marathi-2-26",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u0940\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-27",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-28",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0935\\u093f"
          },
          {
            "grapheme_id": "Marathi-2-30",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0939\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-31",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0939\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-38",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u091c\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-39",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0924\\u0940"
          },
          {
            "grapheme_id": "Marathi-2-3a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0925\\u0940"
          },
          {
            "grapheme_id": "Marathi-2-3d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u092d\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-3f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-40",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0935\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-42",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u200d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-45",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u094d\\u0932\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-49",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u0930\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-4b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-4c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u0940"
          },
          {
            "grapheme_id": "Marathi-2-4d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u0940\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-4e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-4f",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930\\u093e\\u0902"
          },
          {
            "grapheme_id": "Marathi-2-51",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u094d\\u0930\\u093f"
          },
          {
            "grapheme_id": "Marathi-2-53",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Marathi-2-54",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0939\\u094d\\u092f\\u093e"
          }
        ],
        "n_errors": 46,
        "n_total": 103,
        "pct_success": 55.33980582524271
      },
      "Mazahua Central": {
        "failed": [],
        "n_errors": 0,
        "n_total": 3,
        "pct_success": 100.0
      },
      "Mon": {
        "failed": [
          {
            "grapheme_id": "Mon-2-0d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1007\\u103c\\u1031"
          },
          {
            "grapheme_id": "Mon-2-19",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1012\\u1039\\u1002\\u1031"
          },
          {
            "grapheme_id": "Mon-2-22",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1016\\u103b\\u1031\\u1036"
          },
          {
            "grapheme_id": "Mon-2-23",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1017\\u1039\\u1010\\u1031"
          },
          {
            "grapheme_id": "Mon-2-24",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1017\\u1039\\u105c\\u1031"
          },
          {
            "grapheme_id": "Mon-2-26",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u1017\\u103c\\u1031"
          },
          {
            "grapheme_id": "Mon-2-39",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u101e\\u1039\\u1002\\u1031"
          }
        ],
        "n_errors": 7,
        "n_total": 208,
        "pct_success": 96.63461538461539
      },
      "Mòoré": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Nanai": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Navajo": {
        "failed": [],
        "n_errors": 0,
        "n_total": 4,
        "pct_success": 100.0
      },
      "Nepali": {
        "failed": [
          {
            "grapheme_id": "Nepali-2-01",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0924\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-02",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0928\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-03",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0938\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091c\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-0c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091e\\u094d\\u091a\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-11",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0926\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-15",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0915\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-16",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u091a\\u093f"
          },
          {
            "grapheme_id": "Nepali-2-18",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0926\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-19",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0926\\u094b"
          },
          {
            "grapheme_id": "Nepali-2-1d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092b\\u094d\\u0928\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-1e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092b\\u094d\\u0928\\u094b"
          },
          {
            "grapheme_id": "Nepali-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Nepali-2-21",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u092a\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-25",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0926\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-28",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0926\\u094d\\u0927"
          },
          {
            "grapheme_id": "Nepali-2-2a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0928\\u093f"
          },
          {
            "grapheme_id": "Nepali-2-2f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0938\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-33",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930\\u093f"
          },
          {
            "grapheme_id": "Nepali-2-36",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u091f\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Nepali-2-38",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u094b"
          },
          {
            "grapheme_id": "Nepali-2-39",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0930\\u094b"
          }
        ],
        "n_errors": 22,
        "n_total": 71,
        "pct_success": 69.01408450704226
      },
      "Orok": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Otomi, Mezquital": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Panjabi, Eastern": {
        "failed": [],
        "n_errors": 0,
        "n_total": 239,
        "pct_success": 100.0
      },
      "Panjabi, Western": {
        "failed": [],
        "n_errors": 0,
        "n_total": 3,
        "pct_success": 100.0
      },
      "Pashto, Northern": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Picard": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Pular (Adlam)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 24,
        "pct_success": 100.0
      },
      "Sanskrit": {
        "failed": [
          {
            "grapheme_id": "Sanskrit-2-00",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0915\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-02",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0924\\u0947\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-03",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0924\\u094d\\u092f\\u094b\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-04",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-06",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u093e\\u0902"
          },
          {
            "grapheme_id": "Sanskrit-2-07",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-09",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-0a",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0937\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0916\\u094d\\u092f\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-0e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0917\\u094d\\u092f\\u0948\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-0f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0917\\u094d\\u0930\\u094d\\u092f"
          },
          {
            "grapheme_id": "Sanskrit-2-11",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091e\\u094d\\u091a\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-18",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0923\\u094d\\u0921\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-19",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0923\\u094d\\u0921\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-1b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-1d",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0924\\u094d\\u0925\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-24",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0938\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-25",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0924\\u094d\\u0938\\u094d\\u0935\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-27",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-28",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0926\\u094d\\u0927\\u0948\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-2a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0927\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-2c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-2e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u091e\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-33",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-34",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-35",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u0940"
          },
          {
            "grapheme_id": "Sanskrit-2-36",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u094d\\u092f"
          },
          {
            "grapheme_id": "Sanskrit-2-37",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u094d\\u092f\\u0902"
          },
          {
            "grapheme_id": "Sanskrit-2-38",
            "measured_by_terminal": 5,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-39",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0924\\u094d\\u0930\\u094d\\u092f\\u0947"
          },
          {
            "grapheme_id": "Sanskrit-2-3a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0927\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-3c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0928\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-3d",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u0928\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-41",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0928\\u094d\\u092f\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-45",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092a\\u094d\\u0924\\u094c"
          },
          {
            "grapheme_id": "Sanskrit-2-47",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092a\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-49",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092d\\u093f\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-4a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092d\\u094d\\u092f\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-4b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092d\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Sanskrit-2-4d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092d\\u094d\\u092f\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-4e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u0928\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-50",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092f\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-52",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092f\\u094d\\u092f\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-54",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-58",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0917\\u0940"
          },
          {
            "grapheme_id": "Sanskrit-2-5a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u091a\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-5c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0923\\u093e\\u0902"
          },
          {
            "grapheme_id": "Sanskrit-2-5d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0923\\u0940"
          },
          {
            "grapheme_id": "Sanskrit-2-5e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0924\\u093f\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-60",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0924\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-62",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0926\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-64",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0927\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-6a",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0939\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-6b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0939\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-6c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0930\\u094d\\u0939\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-6d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-6e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u094d\\u0915\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-70",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0932\\u094d\\u092f\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-73",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0935\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-75",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-77",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-79",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0936\\u094d\\u0935\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-7a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-7b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-7c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-7d",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-7e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930\\u0947"
          },
          {
            "grapheme_id": "Sanskrit-2-7f",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u091f\\u094d\\u0930\\u094b"
          },
          {
            "grapheme_id": "Sanskrit-2-80",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u092a\\u094d\\u0930"
          },
          {
            "grapheme_id": "Sanskrit-2-81",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0937\\u094d\\u092f\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-83",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0915\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-84",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0915\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-85",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-87",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0924\\u094d\\u0930\\u093e"
          },
          {
            "grapheme_id": "Sanskrit-2-88",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0925\\u093e\\u0902"
          },
          {
            "grapheme_id": "Sanskrit-2-89",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u0927\\u0940"
          },
          {
            "grapheme_id": "Sanskrit-2-8a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u092e\\u093f"
          },
          {
            "grapheme_id": "Sanskrit-2-8b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u092e\\u093f\\u0902"
          },
          {
            "grapheme_id": "Sanskrit-2-8d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u092f\\u093e\\u0902"
          },
          {
            "grapheme_id": "Sanskrit-2-8e",
            "measured_by_terminal": 4,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u092f\\u093e\\u0903"
          },
          {
            "grapheme_id": "Sanskrit-2-8f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0938\\u094d\\u092f\\u0941\\u0903"
          }
        ],
        "n_errors": 81,
        "n_total": 156,
        "pct_success": 48.07692307692308
      },
      "Sanskrit (Grantha)": {
        "failed": [
          {
            "grapheme_id": "Sanskrit (Grantha)-2-03",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011315\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-04",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011315\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-20",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001131f\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-21",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001131f\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-24",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011320\\U00011348\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-2a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011323\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-31",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011324\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-32",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011324\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-34",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011324\\U0001133f\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-35",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011324\\U0001133f\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-37",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011324\\U00011341\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-3a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011324\\U00011347\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-40",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011325\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-4c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011327\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-4e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011327\\U0001133f\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-52",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011327\\U00011347\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-53",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011327\\U00011348\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-57",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011328\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-58",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011328\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-5a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011328\\U0001133f\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-5f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011328\\U00011348\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-6c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001132d\\U0001133f\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-73",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001132e\\U0001133f\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-7d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001132f\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-7e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001132f\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-81",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001132f\\U00011341\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-84",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001132f\\U00011348\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-86",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U0001132f\\U0001134b\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-8a",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011330\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-8c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011330\\U0001133f\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-94",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011332\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-96",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011332\\U0001133f\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-9d",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011335\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-9e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011335\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-a7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011336\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-af",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011337\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-b0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011337\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-b9",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011338\\U0001133e\\U00011302"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-2-c1",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\U00011339\\U0001133e\\U00011303"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-01",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011315\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-03",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011317\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-04",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001131a\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-07",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001131c\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-08",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001131e\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-09",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001131f\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-0c",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011323\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-0e",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011324\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-10",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011326\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-12",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011327\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-14",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011328\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-16",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001132a\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-17",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001132c\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-18",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001132d\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-1a",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001132e\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-1c",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U0001132f\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-1e",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011330\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-1f",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011332\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-21",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011335\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-23",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011336\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-24",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011337\\U0001134d"
          },
          {
            "grapheme_id": "Sanskrit (Grantha)-1-26",
            "measured_by_terminal": 2,
            "measured_by_wcwidth": 1,
            "wchars": "\\U00011338\\U0001134d"
          }
        ],
        "n_errors": 61,
        "n_total": 237,
        "pct_success": 74.26160337552743
      },
      "Secoya": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Seraiki": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Shan": {
        "failed": [],
        "n_errors": 0,
        "n_total": 106,
        "pct_success": 100.0
      },
      "Shipibo-Conibo": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Sinhala": {
        "failed": [],
        "n_errors": 0,
        "n_total": 198,
        "pct_success": 100.0
      },
      "Siona": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "South Azerbaijani": {
        "failed": [],
        "n_errors": 0,
        "n_total": 6,
        "pct_success": 100.0
      },
      "Tagalog (Tagalog)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 16,
        "pct_success": 100.0
      },
      "Tai Dam": {
        "failed": [],
        "n_errors": 0,
        "n_total": 120,
        "pct_success": 100.0
      },
      "Tamang, Eastern": {
        "failed": [
          {
            "grapheme_id": "Tamang, Eastern-2-00",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0915\\u094d\\u0915\\u094b"
          },
          {
            "grapheme_id": "Tamang, Eastern-2-01",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0917\\u094d\\u092f\\u093e"
          },
          {
            "grapheme_id": "Tamang, Eastern-2-03",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u091a\\u094d\\u092f\\u094b"
          },
          {
            "grapheme_id": "Tamang, Eastern-2-07",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u0939\\u0940"
          },
          {
            "grapheme_id": "Tamang, Eastern-2-08",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u092e\\u094d\\u0939\\u094b"
          },
          {
            "grapheme_id": "Tamang, Eastern-2-09",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0939\\u094d\\u0930\\u093e"
          }
        ],
        "n_errors": 6,
        "n_total": 11,
        "pct_success": 45.45454545454545
      },
      "Tamazight, Central Atlas": {
        "failed": [],
        "n_errors": 0,
        "n_total": 5,
        "pct_success": 100.0
      },
      "Tamil": {
        "failed": [],
        "n_errors": 0,
        "n_total": 132,
        "pct_success": 100.0
      },
      "Telugu": {
        "failed": [
          {
            "grapheme_id": "Telugu-2-06",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c15\\u0c41\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-0b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c15\\u0c4d\\u0c15\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-0f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c15\\u0c4d\\u0c24\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-12",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c15\\u0c4d\\u0c30\\u0c3e\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-14",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c15\\u0c4d\\u0c30\\u0c42"
          },
          {
            "grapheme_id": "Telugu-2-18",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c15\\u0c4d\\u0c37\\u0c3f\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-1b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c15\\u0c4d\\u0c38\\u0c4d\\u0c35\\u0c3e"
          },
          {
            "grapheme_id": "Telugu-2-29",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c1a\\u0c4d\\u0c1a\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-34",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c1f\\u0c41\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-36",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c1f\\u0c4d\\u0c32\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-39",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c21\\u0c4d\\u0c30\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-42",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c24\\u0c4d\\u0c24\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-44",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c24\\u0c4d\\u0c28\\u0c3f\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-48",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c24\\u0c4d\\u0c2f\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-4b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c24\\u0c4d\\u0c30\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-4c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c24\\u0c4d\\u0c30\\u0c4d\\u0c2f"
          },
          {
            "grapheme_id": "Telugu-2-53",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c26\\u0c41\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-57",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c26\\u0c4d\\u0c26\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-5b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c26\\u0c4d\\u0c27\\u0c3f\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-5f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c26\\u0c4d\\u0c30\\u0c4d\\u0c2f"
          },
          {
            "grapheme_id": "Telugu-2-69",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c28\\u0c41\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-6f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c28\\u0c4d\\u0c28\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-83",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c2d\\u0c4d\\u0c2f\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-8e",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c2f\\u0c41\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-95",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c1a\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-97",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c23\\u0c3e\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-98",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c23\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-9b",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c24\\u0c3f\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-9c",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c24\\u0c43"
          },
          {
            "grapheme_id": "Telugu-2-9f",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c25\\u0c3f\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-a4",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c2c\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-ad",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c39\\u0c3e\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-ae",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c30\\u0c4d\\u0c39\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-c5",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c36\\u0c4d\\u0c30\\u0c3e\\u0c02"
          },
          {
            "grapheme_id": "Telugu-2-cb",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c37\\u0c4d\\u0c1f\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-cc",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c37\\u0c4d\\u0c1f\\u0c4d\\u0c30"
          },
          {
            "grapheme_id": "Telugu-2-cd",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c37\\u0c4d\\u0c1f\\u0c4d\\u0c30\\u0c40"
          },
          {
            "grapheme_id": "Telugu-2-d0",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c37\\u0c4d\\u0c20\\u0c41"
          },
          {
            "grapheme_id": "Telugu-2-d7",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c38\\u0c4d\\u0c15\\u0c43"
          },
          {
            "grapheme_id": "Telugu-2-da",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c38\\u0c4d\\u0c24\\u0c4d\\u0c30"
          },
          {
            "grapheme_id": "Telugu-2-db",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c38\\u0c4d\\u0c24\\u0c4d\\u0c30\\u0c40"
          },
          {
            "grapheme_id": "Telugu-2-df",
            "measured_by_terminal": 3,
            "measured_by_wcwidth": 2,
            "wchars": "\\u0c38\\u0c4d\\u0c25\\u0c4d\\u0c2f"
          }
        ],
        "n_errors": 42,
        "n_total": 335,
        "pct_success": 87.46268656716418
      },
      "Tem": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Thai": {
        "failed": [],
        "n_errors": 0,
        "n_total": 193,
        "pct_success": 100.0
      },
      "Thai (2)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 14,
        "pct_success": 100.0
      },
      "Tibetan, Central": {
        "failed": [],
        "n_errors": 0,
        "n_total": 48,
        "pct_success": 100.0
      },
      "Ticuna": {
        "failed": [],
        "n_errors": 0,
        "n_total": 13,
        "pct_success": 100.0
      },
      "Uduk": {
        "failed": [],
        "n_errors": 0,
        "n_total": 2,
        "pct_success": 100.0
      },
      "Urdu": {
        "failed": [],
        "n_errors": 0,
        "n_total": 23,
        "pct_success": 100.0
      },
      "Urdu (2)": {
        "failed": [],
        "n_errors": 0,
        "n_total": 1,
        "pct_success": 100.0
      },
      "Vietnamese": {
        "failed": [],
        "n_errors": 0,
        "n_total": 42,
        "pct_success": 100.0
      },
      "Yaneshaʼ": {
        "failed": [],
        "n_errors": 0,
        "n_total": 10,
        "pct_success": 100.0
      },
      "Yiddish, Eastern": {
        "failed": [],
        "n_errors": 0,
        "n_total": 10,
        "pct_success": 100.0
      },
      "Yoruba": {
        "failed": [],
        "n_errors": 0,
        "n_total": 8,
        "pct_success": 100.0
      }
    },
    "narrow_results": {
      "18.0.0": {
        "failed_codepoints": [],
        "n_errors": 0,
        "n_total": 5000,
        "pct_success": 100.0
      }
    },
    "ri_results": {
      "18.0.0": {
        "failed_codepoints": [],
        "n_errors": 0,
        "n_total": 262,
        "pct_success": 100.0
      }
    },
    "sfz_results": {
      "18.0.0": {
        "failed_codepoints": [],
        "n_errors": 0,
        "n_total": 5,
        "pct_success": 100.0
      }
    },
    "sri_results": {
      "18.0.0": {
        "failed_codepoints": [],
        "n_errors": 0,
        "n_total": 26,
        "pct_success": 100.0
      }
    },
    "tofu_results": {
      "18.0.0": {
        "blocks": {
          "Basic Latin": {
            "codepoint_ranges": [
              [
                32,
                126
              ]
            ],
            "n_errors": 95,
            "n_total": 95
          },
          "Cyrillic": {
            "codepoint_ranges": [
              [
                1024,
                1154
              ],
              [
                1162,
                1279
              ]
            ],
            "n_errors": 249,
            "n_total": 249
          },
          "Greek and Coptic": {
            "codepoint_ranges": [
              [
                880,
                887
              ],
              [
                890,
                895
              ],
              [
                900,
                906
              ],
              [
                908,
                908
              ],
              [
                910,
                929
              ],
              [
                931,
                1023
              ]
            ],
            "n_errors": 135,
            "n_total": 135
          },
          "IPA Extensions": {
            "codepoint_ranges": [
              [
                592,
                687
              ]
            ],
            "n_errors": 96,
            "n_total": 96
          },
          "Latin Extended-A": {
            "codepoint_ranges": [
              [
                256,
                383
              ]
            ],
            "n_errors": 128,
            "n_total": 128
          },
          "Latin Extended-B": {
            "codepoint_ranges": [
              [
                384,
                591
              ]
            ],
            "n_errors": 208,
            "n_total": 208
          },
          "Latin-1 Supplement": {
            "codepoint_ranges": [
              [
                160,
                172
              ],
              [
                174,
                255
              ]
            ],
            "n_errors": 95,
            "n_total": 95
          },
          "Spacing Modifier Letters": {
            "codepoint_ranges": [
              [
                688,
                767
              ]
            ],
            "n_errors": 80,
            "n_total": 80
          }
        },
        "include_uncommon": false,
        "n_errors": 1086,
        "n_total": 1086,
        "n_unknown": 0,
        "pct_success": 0.0,
        "protocol": "glyph"
      }
    },
    "unicode_wide_results": {
      "18.0.0": {
        "failed_codepoints": [
          {
            "measured_by_terminal": 0,
            "measured_by_wcwidth": 2,
            "wchar": "\\u115f"
          }
        ],
        "n_errors": 1,
        "n_total": 1529,
        "pct_success": 99.9345977763244
      }
    }
  },
  "ucs_detect_version": "2.3.9",
  "unicode_version": "18.0.0",
  "wcwidth_version": "0.9.4",
  "width": 80
}
```
