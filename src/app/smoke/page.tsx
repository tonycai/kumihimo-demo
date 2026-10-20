import Link from "next/link";

import { SmokeTest } from "@/components/SmokeTest";
import { t } from "@/i18n";

/** Stage 0 check kept for AT-03 (real text-to-image once the key exists). */
export default function SmokePage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-4 px-6 py-10">
      <Link href="/" className="self-start text-sm underline">
        {t("app.title")}
      </Link>
      <SmokeTest />
    </main>
  );
}
