import React from "react";
import TypicalIssuesPanel from "../components/TypicalIssuesPanel";

export default function HomePage() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <TypicalIssuesPanel showHeader={false} />
    </div>
  );
}
