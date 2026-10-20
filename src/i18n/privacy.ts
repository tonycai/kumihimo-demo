/**
 * Privacy notice for live mode (DP-09), draft v0.3: kept for when live mode is switched on. While
 * the demo runs on demo data only, /privacy shows privacy-demo.ts (v0.4) instead. The
 * Japanese text prevails and is needs_native_review. Inline markup: **bold** and [label](url).
 */
import { COMPANY_URL, CONTACT_URL } from "@/site/links";

// KQ-11: still a draft until the content is confirmed; the page says so while this is true.
export const PRIVACY_DRAFT = true;

export type Block =
  | { h: string }
  | { p: string }
  | { ol: string[] }
  | { ul: string[] }
  | { table: { head: [string, string]; rows: [string, string][] } };

export interface PrivacyText {
  lang: "ja" | "en";
  title: string;
  dates: string;
  operator: string;
  blocks: Block[];
}

const ATLAS_PRIVACY_URL = "https://www.atlascloud.ai/privacy";
/** PPC page on the United States (federal and New York), checked 2026-10-19. */
const PPC_FOREIGN_SYSTEMS_URL = "https://www.ppc.go.jp/enforcement/infoprovision/laws/offshore_report_america/";
// KQ-11: the dates are filled in at launch.
const LAUNCH = "〔公開日〕";
// KQ-2 A (kumihimo.solanalink.jp): cookies other SolanaLink sites set on .solanalink.jp reach this host
// too. Set false if KQ-2 goes to B (run.app), and the sentence about them disappears.
const PARENT_DOMAIN_COOKIES = true;

export const PRIVACY_JA: PrivacyText = {
  lang: "ja",
  title: "プライバシーについて（Kumihimo デモ）",
  dates: `制定日：2026年10月${LAUNCH}｜最終改定日：2026年10月${LAUNCH}`,
  operator: `運営者：ソラナリンク株式会社（SolanaLink Co., Ltd.）｜[会社概要](${COMPANY_URL})・[お問い合わせ](${CONTACT_URL})`,
  blocks: [
    {
      p: "本ページは、デモサイト「Kumihimo」（以下「本デモ」）における情報の取扱いについて説明するものです。当社プライバシーポリシーの改定版が公開され次第、そちらへのリンクに切り替えます。",
    },
    { h: "1. 取得する情報" },
    {
      ol: [
        "**入力内容**：パスコードで実行モードを利用する場合に入力されたプロンプト（テキスト）およびアップロードされた画像。",
        "**アクセス制限のための情報**：不正利用を防ぐためのアクセス回数の制限に、IP アドレスを使用します。IP アドレスそのものは保存せず、復元できない形（ソルト付きハッシュ）で、最長 25 時間保存した後に削除します。",
        "**利用状況の集計**：パスコードの種類ごとの実行回数や、費用の見積もりの集計値、「Work with SolanaLink」リンクのクリック数。パスコードそのもの、プロンプト、画像、クリックした方の IP アドレスやブラウザの情報は記録しません。",
        "**Cookie**：パスコード確認後のログイン状態を保つための Cookie を 1 つ使用します。広告や分析のための Cookie、第三者の解析ツールは使用しません。" +
          (PARENT_DOMAIN_COOKIES
            ? "なお、当社の他のサイトが solanalink.jp 全体に設定した Cookie（アクセス解析用のものを含む）が、お使いのブラウザから本デモにも送信されることがありますが、本デモではこれらを利用せず、記録もしません。"
            : ""),
        "**お使いのブラウザ内の保存**：生成結果へのリンクなどは、お使いのブラウザ内（IndexedDB）にのみ保存され、当社のサーバーには送信されません。画像アップロード時の同意の記録も、ブラウザのタブ内（sessionStorage）にのみ保存され、タブを閉じると消えます。",
      ],
    },
    { h: "2. 利用目的" },
    {
      ol: [
        "本デモの機能（テキスト・画像・動画の生成）の提供",
        "不正利用の防止と、費用の上限管理",
        "本デモの利用状況の把握（集計値のみ）",
      ],
    },
    { h: "3. 外国にある第三者への提供" },
    {
      ul: [
        "生成のため、入力されたプロンプトとアップロードされた画像は、当社のサーバーを経由して **ATLAS CLOUD AI INC.（アメリカ合衆国）** の API に送信されます。",
        "当社のサーバーは、アップロードされた画像を保存せず、送信後に破棄します。生成結果も当社のサーバーには保存しません。",
        "ATLAS CLOUD AI INC. での保存：画像・動画の生成では、当社は同社に対し、プロンプトを含む依頼の記録を生成終了時に削除し、生成結果を 24 時間後に削除するよう指定しています。アップロードされた画像は同社が定期的に削除するとしていますが、期間は公表されていません。テキスト生成への入力の保存期間は、同社の定めによります（いずれも同社の公開資料による。2026年10月時点）。",
        "モデルによっては、ATLAS CLOUD AI INC. がそのモデルの提供元（OpenAI、Google、BytePlus、Alibaba Cloud、xAI など）に処理を委託する場合があり、その場合は各社の保存の定めが適用されます。処理される国は公表されておらず、アメリカ合衆国以外の国となる可能性があります。",
        "アップロードされた画像（およびそれをもとに作られた画像）は、同社が自ら運用していることを当社が確認したモデルでのみ処理します。",
        "生成結果の画像・動画は、ATLAS CLOUD AI INC.（またはその配信サーバー）からお使いのブラウザに直接読み込まれます。その際、IP アドレスやブラウザの種類など、通信に必要な情報が同社に送信されます。",
        `アメリカ合衆国の個人情報保護制度については、個人情報保護委員会が公表している[外国制度に関する情報](${PPC_FOREIGN_SYSTEMS_URL})をご参照ください。`,
        `ATLAS CLOUD AI INC. が講じている措置については、[同社のプライバシーポリシー](${ATLAS_PRIVACY_URL})をご参照ください。`,
        "画像を初めてアップロードする際に、本項の内容への同意と、他の方が写っている場合にその方の同意を得ていることを確認します。",
      ],
    },
    { h: "4. 保存期間" },
    {
      table: {
        head: ["情報", "当社での保存"],
        rows: [
          ["プロンプト・アップロード画像・生成結果", "保存しません"],
          ["アクセス制限のためのハッシュ値", "最長 25 時間"],
          ["生成の受付番号とパスコードの種類の対応", "最長 2 日間"],
          [
            "アップロード画像に由来する URL のハッシュ値（アップロード画像を、当社が確認したモデルでのみ処理するため）",
            "最長 16 日間",
          ],
          ["利用状況の集計値", "本デモの終了まで（終了時に削除）"],
        ],
      },
    },
    { h: "5. お願い" },
    {
      p: "他の方が写っている画像は、その方の同意を得ている場合に限りアップロードしてください。そのほか、ご本人以外の個人情報（氏名、連絡先など）が写っている画像はアップロードしないでください。",
    },
    { h: "6. 安全管理" },
    {
      p: "API キーとパスコードはサーバー側でのみ管理し、ログには記録しません。ログにはプロンプト、画像、IP アドレスの元の値を記録しません。",
    },
    { h: "7. お問い合わせ" },
    { p: `本ページの内容に関するお問い合わせは、[公式サイトのお問い合わせページ](${CONTACT_URL})からご連絡ください。` },
    { h: "8. 改定" },
    { p: "本ページの内容は、必要に応じて改定します。改定した場合は、本ページの最終改定日を更新します。" },
  ],
};

export const PRIVACY_EN: PrivacyText = {
  lang: "en",
  title: "Privacy at Kumihimo (demo)",
  dates: `Established: October ${LAUNCH}, 2026 | Last revised: October ${LAUNCH}, 2026`,
  operator: `Operator: SolanaLink Co., Ltd. (ソラナリンク株式会社) | [Company profile](${COMPANY_URL}) and [contact](${CONTACT_URL})`,
  blocks: [
    {
      p: 'This page explains how the Kumihimo demo ("the Demo") handles information. Once the revised SolanaLink privacy policy is published, this page will link to it instead. This English version is a reference translation; the Japanese version prevails.',
    },
    { h: "1. Information we collect" },
    {
      ol: [
        "**What you enter**: prompts (text) and images you upload when you use live mode with a passcode.",
        "**Rate limiting**: we use your IP address to limit the number of requests and prevent abuse. We do not store the IP address itself; we keep only a salted hash, and delete it within 25 hours.",
        '**Usage totals**: counts of runs and estimated costs per passcode type, and the number of clicks on the "Work with SolanaLink" link. We do not record the passcode itself, your prompts or your images, or the IP address or browser details of anyone who clicks.',
        "**Cookie**: one cookie that keeps you signed in after you enter the passcode. We do not use advertising or analytics cookies, or third-party analytics tools." +
          (PARENT_DOMAIN_COOKIES
            ? " Cookies that our other sites set for the whole solanalink.jp domain (including analytics cookies) may also be sent by your browser to the Demo; the Demo does not use or record them."
            : ""),
        "**Stored in your browser**: links to your results are kept only in your browser (IndexedDB) and are not sent to our servers. Your consent to image uploads is remembered only in the current browser tab (sessionStorage) and is cleared when you close the tab.",
      ],
    },
    { h: "2. How we use it" },
    {
      ol: [
        "To run the Demo (generating text, images and video)",
        "To prevent abuse and keep costs within limits",
        "To understand how the Demo is used (totals only)",
      ],
    },
    { h: "3. Transfer to a third party outside Japan" },
    {
      ul: [
        "To generate results, your prompts and uploaded images are sent through our server to the API of **ATLAS CLOUD AI INC. (United States)**.",
        "Our server does not store uploaded images; it discards them after forwarding. We do not store generated results on our server either.",
        "Retention at ATLAS CLOUD AI INC.: for image and video generation, we instruct the company to delete the request record, including your prompt, when generation finishes, and to delete the generated result after 24 hours. The company says it deletes uploaded images periodically but does not state a period. Inputs to text generation are kept according to the company's own rules (all per its public documentation, as of October 2026).",
        "For some models, ATLAS CLOUD AI INC. may have the model's provider (such as OpenAI, Google, BytePlus, Alibaba Cloud or xAI) process the request, in which case that provider's retention rules apply. The countries where processing takes place are not published and may include countries other than the United States. Uploaded images, and images made from them, are processed only by models we have confirmed the company runs itself.",
        "Generated images and videos load directly from ATLAS CLOUD AI INC.'s servers (or its delivery servers) into your browser. When they do, information needed for the connection, such as your IP address and browser type, is sent to that company.",
        `For the personal information protection system in the United States, please see [the information on foreign systems published by Japan's Personal Information Protection Commission](${PPC_FOREIGN_SYSTEMS_URL}).`,
        `For the measures ATLAS CLOUD AI INC. takes, please see [its privacy policy](${ATLAS_PRIVACY_URL}).`,
        "The first time you upload an image, we ask you to agree to this section and to confirm that anyone else shown in the image has agreed.",
      ],
    },
    { h: "4. Retention" },
    {
      table: {
        head: ["Information", "Kept by us"],
        rows: [
          ["Prompts, uploaded images, generated results", "Not stored"],
          ["Hashes for rate limiting", "Up to 25 hours"],
          ["Link between a generation ID and the passcode type", "Up to 2 days"],
          ["Hashes of URLs derived from uploaded images (so that only models we have confirmed process them)", "Up to 16 days"],
          ["Usage totals", "Until the Demo ends (then deleted)"],
        ],
      },
    },
    { h: "5. Please note" },
    {
      p: "Please upload images showing other people only if they have agreed. Do not upload images that contain other people's personal information, such as names or contact details.",
    },
    { h: "6. Security" },
    {
      p: "API keys and passcodes are handled only on the server and are never logged. Our logs do not record prompts, images or raw IP addresses.",
    },
    { h: "7. Contact" },
    { p: `For questions about this page, please use [the contact page on our official site](${CONTACT_URL}).` },
    { h: "8. Changes" },
    { p: 'We may revise this page as needed. When we do, we will update the "Last revised" date above.' },
  ],
};
