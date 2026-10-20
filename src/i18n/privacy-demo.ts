/**
 * Privacy notice for the demo as it runs now (DP-09): demo data only, live mode off. Draft v0.4;
 * the Japanese text prevails and is needs_native_review. The live-mode notice stays in
 * privacy.ts for when live mode is switched on. Inline markup: **bold** and [label](url).
 */
import { COMPANY_URL, CONTACT_URL } from "@/site/links";

import type { Block, PrivacyText } from "./privacy";

export interface Hosting {
  /** Served from a public host (not this computer): access logs and hosting are described. */
  public: boolean;
  /** Served under solanalink.jp: cookies other SolanaLink sites set on the parent domain reach it. */
  solanalinkSubdomain: boolean;
}

const OFFICIAL_PRIVACY_URL = "https://www.solanalink.jp/ja/privacy-policy";
// KQ-11: the dates are filled in when the page is published.
const LAUNCH = "〔公開日〕";

/** Where the page is served from, read from the request's Host header. */
export function hostingOf(host: string | null): Hosting {
  const name = (host ?? "").split(":")[0].toLowerCase();
  const local = name === "" || name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name.endsWith(".localhost");
  return { public: !local, solanalinkSubdomain: name.endsWith(".solanalink.jp") };
}

export function demoPrivacyJa(h: Hosting): PrivacyText {
  const blocks: Block[] = [
    { p: "本ページは、デモサイト「Kumihimo」（以下「本デモ」）における情報の取扱いについて説明するものです。本デモはサンプルデータで動作し、外部の AI サービスには接続しません。" },
    { h: "1. 当社のサーバーに送信されない情報" },
    { p: "入力したプロンプト、アップロードした画像、表示される生成結果（サンプル）は、お使いのブラウザの中だけで扱われ、当社のサーバーには送信されません。" },
    { h: "2. 当社が記録する情報" },
    {
      ul: [
        "「Work with SolanaLink」リンクがクリックされた回数を記録します。クリックした方の IP アドレスやブラウザの情報は記録しません。",
        ...(h.public ? ["本デモのサーバーでは、IP アドレスを含むアクセスログを保存しない設定にしています。"] : []),
        "利用目的：本デモの効果の把握（回数の集計のみ）。",
      ],
    },
    { h: "3. お使いのブラウザ内の保存" },
    {
      ul: [
        "作業中のキャンバスは、お使いのブラウザ内（IndexedDB）に自動保存されます。当社のサーバーには送信されません。",
        "「このタブでデモを続ける」の設定は、ブラウザのタブ内（sessionStorage）にのみ保存され、タブを閉じると消えます。",
        "本デモは Cookie を使用しません。" +
          (h.solanalinkSubdomain
            ? "なお、当社の他のサイトが solanalink.jp 全体に設定した Cookie（アクセス解析用のものを含む）が、お使いのブラウザから本デモにも送信されることがありますが、本デモではこれらを利用せず、記録もしません。"
            : ""),
        "ブラウザの設定からサイトデータを削除すると、上記の保存内容はすべて消えます。",
      ],
    },
    { h: "4. 外部への送信" },
    {
      ul: [
        "本デモは、広告やアクセス解析のツール、外部のフォントやスクリプトを読み込みません。",
        `「Work with SolanaLink」をクリックすると、当社公式サイトのお問い合わせページに移動します。その際、本デモから来たことを示す情報（from=kumihimo など）が URL に付きます。公式サイトでの情報の取扱いは、[公式サイトのプライバシーポリシー](${OFFICIAL_PRIVACY_URL})によります。`,
      ],
    },
    ...(h.public ? ([{ h: "5. 運用環境" }, { p: "本デモは Google Cloud（東京リージョン）で運用しています。" }] as Block[]) : []),
    { h: `${h.public ? 6 : 5}. お問い合わせ` },
    { p: `本ページの内容に関するお問い合わせは、[公式サイトのお問い合わせページ](${CONTACT_URL})からご連絡ください。` },
    { h: `${h.public ? 7 : 6}. 改定` },
    { p: "本ページの内容は、必要に応じて改定します。改定した場合は、本ページの最終改定日を更新します。" },
  ];
  return {
    lang: "ja",
    title: "プライバシーについて（Kumihimo デモ）",
    dates: `制定日：2026年10月${LAUNCH}｜最終改定日：2026年10月${LAUNCH}`,
    operator: `運営者：ソラナリンク株式会社（SolanaLink Co., Ltd.）｜[会社概要](${COMPANY_URL})・[お問い合わせ](${CONTACT_URL})`,
    blocks,
  };
}

export function demoPrivacyEn(h: Hosting): PrivacyText {
  const blocks: Block[] = [
    {
      p: 'This page explains how the Kumihimo demo ("the Demo") handles information. The Demo runs on sample data and does not connect to any external AI service. This English version is a reference translation; the Japanese version prevails.',
    },
    { h: "1. What never reaches our servers" },
    { p: "Your prompts, the images you upload and the results shown (samples) are handled only inside your browser. They are not sent to our servers." },
    { h: "2. What we record" },
    {
      ul: [
        'We count clicks on the "Work with SolanaLink" link. We do not record the IP address or browser details of anyone who clicks.',
        ...(h.public ? ["The Demo's server is set up not to keep access logs that contain IP addresses."] : []),
        "Purpose: to understand how the Demo performs (counts only).",
      ],
    },
    { h: "3. Stored in your browser" },
    {
      ul: [
        "Your canvas is saved automatically in your browser (IndexedDB). It is not sent to our servers.",
        "Your choice to keep using the demo in this tab is stored only in that tab (sessionStorage) and is cleared when you close it.",
        "The Demo does not use cookies." +
          (h.solanalinkSubdomain
            ? " Cookies that our other sites set for the whole solanalink.jp domain (including analytics cookies) may also be sent by your browser to the Demo; the Demo does not use or record them."
            : ""),
        "Clearing site data in your browser settings removes everything stored above.",
      ],
    },
    { h: "4. Sending information elsewhere" },
    {
      ul: [
        "The Demo loads no advertising or analytics tools, and no external fonts or scripts.",
        `Clicking "Work with SolanaLink" takes you to the contact page on our official site, with a marker in the URL showing that you came from the Demo (such as from=kumihimo). [The official site's privacy policy](${OFFICIAL_PRIVACY_URL}) applies there.`,
      ],
    },
    ...(h.public ? ([{ h: "5. Hosting" }, { p: "The Demo runs on Google Cloud (Tokyo region)." }] as Block[]) : []),
    { h: `${h.public ? 6 : 5}. Contact` },
    { p: `For questions about this page, please use [the contact page on our official site](${CONTACT_URL}).` },
    { h: `${h.public ? 7 : 6}. Changes` },
    { p: 'We may revise this page as needed. When we do, we will update the "Last revised" date above.' },
  ];
  return {
    lang: "en",
    title: "Privacy at Kumihimo (demo)",
    dates: `Established: October ${LAUNCH}, 2026 | Last revised: October ${LAUNCH}, 2026`,
    operator: `Operator: SolanaLink Co., Ltd. (ソラナリンク株式会社) | [Company profile](${COMPANY_URL}) and [contact](${CONTACT_URL})`,
    blocks,
  };
}
