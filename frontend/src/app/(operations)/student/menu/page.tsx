import type { Metadata } from "next";

import { MenuBoard } from "@/components/menu/menu-board";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Menu" };

export default function StudentMenuPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {() => (
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <MenuBoard />
        </main>
      )}
    </ProtectedArea>
  );
}
