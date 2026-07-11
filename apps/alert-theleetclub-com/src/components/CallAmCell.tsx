import { resolveAreaManagerEmail, resolveAreaManagerFromMachineName } from '@/data/operatorAreaPlan';
import { slackAppRedirectUserUrl, slackUserDmUrl } from '@/lib/slackLinks';
import { RED_FLAGS_COLUMNS } from '@/features/redflags/redFlagsWorkbookColumns';
import { stopRowActivation } from '@/lib/stopRowClick';

export function CallAmCell({
  machineName,
  machineLabel,
  slackEmailMap,
  slackTeamId,
}: {
  machineName: string;
  machineLabel: string;
  slackEmailMap?: Record<string, string>;
  slackTeamId?: string;
}) {
  const am = resolveAreaManagerFromMachineName(machineName || machineLabel);
  const email = am ? resolveAreaManagerEmail(am, slackEmailMap) : null;
  const slackId = email ? slackEmailMap?.[email.toLowerCase()] : undefined;
  const team = slackTeamId?.trim() || '';
  const slackUrl = slackId && team ? slackUserDmUrl(team, slackId) : '';
  const slackHttps = slackId && team ? slackAppRedirectUserUrl(team, slackId) : '';
  const label = am === 'suhaib' ? 'Suhaib' : am === 'ahmed' ? 'Ahmed' : 'AM';

  if (slackUrl) {
    return (
      <a
        href={slackUrl}
        className="linkGo"
        title={RED_FLAGS_COLUMNS.callAm.placeholderNote ?? RED_FLAGS_COLUMNS.callAm.sub}
        onPointerDown={stopRowActivation}
        onClick={stopRowActivation}
      >
        {label}
      </a>
    );
  }
  if (slackHttps) {
    return (
      <a
        href={slackHttps}
        className="linkGo"
        target="_blank"
        rel="noopener noreferrer"
        title={RED_FLAGS_COLUMNS.callAm.placeholderNote ?? RED_FLAGS_COLUMNS.callAm.sub}
        data-stop-row-click
        onPointerDownCapture={stopRowActivation}
        onPointerDown={stopRowActivation}
        onClick={stopRowActivation}
      >
        {label}
      </a>
    );
  }
  if (am) {
    const noSlackTitle =
      'Slack DM unavailable — missing Slack user ID for this AM or team ID is not configured';
    return (
      <span className="linkGo linkGo--noSlack" title={noSlackTitle} aria-disabled="true">
        {label}
      </span>
    );
  }
  return (
    <span className="wireDash" title={RED_FLAGS_COLUMNS.callAm.placeholderNote}>
      —
    </span>
  );
}
