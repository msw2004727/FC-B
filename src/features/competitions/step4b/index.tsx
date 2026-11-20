// 第 4 步預覽入口。只給 harness 與測試用，不從 competitions/index 再出口。

import type { JSX } from 'preact';
import type { Step4bScreen } from '../testing/step4b-fixtures';
import { AdditionRequestScreen, AdditionReviewScreen, ClaimScreen, LinkJoinScreen, LinkRepScreen } from './links';
import { AuditLogScreen, CheckinPrintScreen, ScheduleMidnightScreen } from './other';
import { RulesAdvancedScreen, RulesPublicScreen, RulesTemplateScreen } from './rules';
import { InviteAcceptScreen, ScorerMatchesScreen, StaffAssignScreen, StaffListScreen } from './staff';
// 示範畫面專用樣式：排在元件匯入之後，才會接在 step4b.css 後面載入。
import './step4b-demo.css';

export {
  AdditionRequestScreen,
  AdditionReviewScreen,
  AuditLogScreen,
  CheckinPrintScreen,
  ClaimScreen,
  InviteAcceptScreen,
  LinkJoinScreen,
  LinkRepScreen,
  RulesAdvancedScreen,
  RulesPublicScreen,
  RulesTemplateScreen,
  ScheduleMidnightScreen,
  ScorerMatchesScreen,
  StaffAssignScreen,
  StaffListScreen,
};

/** 依畫面 id 畫預覽。每個 id 都有對應分支，缺一個就過不了型別檢查。 */
export function renderStep4bScreen(screen: Step4bScreen): JSX.Element {
  switch (screen) {
    case 'staff-list-cohost':
      return <StaffListScreen viewerRole="coHost" />;
    case 'invite-accept':
      return <InviteAcceptScreen />;
    case 'invite-accept-invalid':
      return <InviteAcceptScreen status="expired" />;
    case 'scorer-my-matches':
      return <ScorerMatchesScreen />;
    case 'link-rep':
      return <LinkRepScreen />;
    case 'link-join':
      return <LinkJoinScreen />;
    case 'link-join-minor':
      return <LinkJoinScreen minor />;
    case 'link-join-birthday':
      return <LinkJoinScreen needBirthday />;
    case 'link-join-full':
      return <LinkJoinScreen status="rosterFull" />;
    case 'link-join-invalid':
      return <LinkJoinScreen status="invalid" />;
    case 'claim':
      return <ClaimScreen />;
    case 'claim-age-mismatch':
      return <ClaimScreen status="ageMismatch" />;
    case 'addition-request':
      return <AdditionRequestScreen />;
    case 'addition-review':
      return <AdditionReviewScreen />;
    case 'rules-template':
      return <RulesTemplateScreen />;
    case 'rules-advanced':
      return <RulesAdvancedScreen />;
    case 'rules-public':
      return <RulesPublicScreen />;
    case 'checkin-print':
      return <CheckinPrintScreen viewer="host" />;
    case 'audit-log':
      return <AuditLogScreen />;
    case 'schedule-midnight':
      return <ScheduleMidnightScreen />;
  }
}
