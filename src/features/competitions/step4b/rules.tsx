// C. 規則選單補預覽。範本值照 K8：五人 2×20 中場 5、七人 2×25 中場 5、十一人 2×35 中場 10。
// 進階預設收合，由 harness 點「進階」打開。補充說明沒內容就收著。淘汰賽未支援，公開頁不印。

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import {
  S4B_DRAFT_POINTS,
  S4B_PUBLISHED,
  S4B_TEMPLATES,
  S4B_TIEBREAK,
  TIMEOUT_BASIS,
  formatSigned,
  pointsWarn,
  type S4bTimeout,
  type TemplateId,
  type TimeoutBasis,
} from '../testing/step4b-fixtures';
import { cardWeightLabel, copy, criterionLabel, publicTimeoutLines, templateTimeoutLine, templateTitle, timeoutBasisLabel } from './copy';
import { Chevron, Line, NoteSlot, S4bCard, S4bFrame } from './ui';

export function RulesTemplateScreen(): JSX.Element {
  const [picked, setPicked] = useState<TemplateId | null>(null);
  return (
    <S4bFrame title={copy.templateTitle} screen="rules-template">
      {S4B_TEMPLATES.map((item) => (
        <S4bCard key={item.id}>
          <div class="s4b-gap">
            <h2 class="s4b-h">{templateTitle[item.id]}</h2>
            {/* 人數與時間一行。暫停句放第二行，避免 360 寬從句子中間斷開。 */}
            <Line text={copy.templateSummary(item.players, item.half, item.halftime)} />
            <Line text={templateTimeoutLine(item.timeout)} />
            <div class="s4b-blockbtn">
              <Button variant={picked === item.id ? 'secondary' : 'primary'} onClick={() => setPicked(item.id)}>
                {copy.useTemplate}
              </Button>
            </div>
          </div>
        </S4bCard>
      ))}
    </S4bFrame>
  );
}

function TimeoutCard({ seed }: { seed: S4bTimeout }): JSX.Element {
  const [open, setOpen] = useState(seed.enabled);
  const [basis, setBasis] = useState<TimeoutBasis>(seed.basis);
  const [perTeam, setPerTeam] = useState(seed.perTeam);
  const [seconds, setSeconds] = useState(seed.seconds);
  const [stopClock, setStopClock] = useState(seed.stopClock);
  const [extra, setExtra] = useState(seed.extraPerTeam);
  function pickBasis(next: string): void {
    if (next === 'half' || next === 'match' || next === 'period') setBasis(next);
  }
  return (
    <S4bCard>
      <div class="s4b-gap">
        <h2 class="s4b-h">{copy.timeoutTitle}</h2>
        <Switch label={copy.timeoutEnabled} checked={open} onCheckedChange={setOpen} />
        {open ? (
          <>
            <RadioGroup
              label={copy.timeoutBasis}
              value={basis}
              orientation="vertical"
              options={TIMEOUT_BASIS.map((id) => ({ value: id, label: timeoutBasisLabel[id] }))}
              onValueChange={pickBasis}
            />
            <Stepper label={copy.timeoutPerTeam} value={perTeam} min={0} max={5} onValueChange={setPerTeam} />
            <Stepper label={copy.timeoutSeconds} value={seconds} min={30} max={180} step={10} onValueChange={setSeconds} />
            <Switch label={copy.timeoutStopClock} checked={stopClock} onCheckedChange={setStopClock} />
            <Stepper label={copy.timeoutExtra} value={extra} min={0} max={3} onValueChange={setExtra} />
            <NoteSlot text={null} />
            <p class="s4b-foot">{copy.timeoutHint}</p>
          </>
        ) : null}
      </div>
    </S4bCard>
  );
}

export function RulesAdvancedScreen({
  subMode = 'free',
  advancedOpen = false,
  timeout = S4B_PUBLISHED.timeout,
}: {
  subMode?: 'free' | 'limited';
  advancedOpen?: boolean;
  timeout?: S4bTimeout;
}): JSX.Element {
  const [sub, setSub] = useState(subMode);
  const [win, setWin] = useState<number>(S4B_DRAFT_POINTS.win);
  const [draw, setDraw] = useState<number>(S4B_DRAFT_POINTS.draw);
  const [loss, setLoss] = useState<number>(S4B_DRAFT_POINTS.loss);
  const [open, setOpen] = useState(advancedOpen);
  const [mercy, setMercy] = useState(true);
  const [cap, setCap] = useState(7);
  const [yellow, setYellow] = useState<number>(S4B_PUBLISHED.fair.yellow);
  const [secondYellow, setSecondYellow] = useState<number>(S4B_PUBLISHED.fair.secondYellow);
  const [directRed, setDirectRed] = useState<number>(S4B_PUBLISHED.fair.directRed);
  const [yellowRed, setYellowRed] = useState<number>(S4B_PUBLISHED.fair.yellowThenRed);
  const [maxCount, setMaxCount] = useState(5);
  const warn = pointsWarn(win, draw, loss);
  return (
    <S4bFrame title={copy.rulesEditTitle} screen="rules-advanced">
      <S4bCard>
        <div class="s4b-gap">
          <h2 class="s4b-h">{copy.subTitle}</h2>
          <Select
            label={copy.subMode}
            value={sub}
            onValueChange={(next) => setSub(next === 'limited' ? 'limited' : 'free')}
            options={[
              { value: 'free', label: copy.freeSub },
              { value: 'limited', label: copy.limitedSub },
            ]}
          />
          {sub === 'limited' ? (
            <>
              <Stepper label={copy.subMax} value={maxCount} min={1} max={15} onValueChange={setMaxCount} />
              <p class="s4b-warn">{copy.subHint}</p>
            </>
          ) : null}
          <NoteSlot text={null} />
        </div>
      </S4bCard>
      <TimeoutCard seed={timeout} />
      <S4bCard>
        <div class="s4b-gap">
          <h2 class="s4b-h">{copy.pointsTitle}</h2>
          <Stepper label={copy.winLabel} value={win} min={0} max={20} onValueChange={setWin} />
          <Stepper label={copy.drawLabel} value={draw} min={0} max={20} onValueChange={setDraw} />
          <Stepper label={copy.lossLabel} value={loss} min={-20} max={20} onValueChange={setLoss} />
          {warn.winLow ? <p class="s4b-warn">{copy.pointsWarnWin}</p> : null}
          {warn.lossHigh ? <p class="s4b-warn">{copy.pointsWarnLoss}</p> : null}
          <NoteSlot text={null} />
        </div>
      </S4bCard>
      <S4bCard>
        <button
          type="button"
          class={open ? 's4b-fold s4b-fold--open' : 's4b-fold'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{copy.advanced}</span>
          <Chevron />
        </button>
        {open ? (
          <>
            <div class="s4b-sub">
              <div class="s4b-gap">
                <h3 class="s4b-h">{copy.fairTitle}</h3>
                <Line text={copy.fairHint} />
                <p class="s4b-status">{copy.fairLater}</p>
                <Stepper label={copy.yellowLabel} value={yellow} min={-20} max={0} onValueChange={setYellow} />
                <Stepper label={copy.secondYellowLabel} value={secondYellow} min={-20} max={0} onValueChange={setSecondYellow} />
                <Stepper label={copy.directRedLabel} value={directRed} min={-20} max={0} onValueChange={setDirectRed} />
                <Stepper label={copy.yellowRedLabel} value={yellowRed} min={-20} max={0} onValueChange={setYellowRed} />
                <NoteSlot text={copy.fairNote} />
              </div>
            </div>
            <div class="s4b-sub">
              <div class="s4b-gap">
                <h3 class="s4b-h">{copy.mercyTitle}</h3>
                <Switch label={copy.mercySwitch} checked={mercy} onCheckedChange={setMercy} />
                {mercy ? <Stepper label={copy.mercyCap} value={cap} min={1} max={30} onValueChange={setCap} /> : null}
                {mercy ? (
                  <p class="s4b-line">
                    <span class="s4b-k">{copy.mercyMsg1}</span>
                    <span class="s4b-v">{copy.mercyMsg2}</span>
                  </p>
                ) : null}
                <NoteSlot text={null} />
              </div>
            </div>
            <div class="s4b-sub">
              <div class="s4b-gap">
                <h3 class="s4b-h">{copy.h2hTitle}</h3>
                <Line text={copy.algo1} />
                <Line text={copy.algo2} />
                <NoteSlot text={null} />
              </div>
            </div>
          </>
        ) : null}
      </S4bCard>
      <div class="s4b-blockbtn">
        <Button variant="primary">{copy.save}</Button>
      </div>
    </S4bFrame>
  );
}

/** 值是「未設定」的整行不顯示。沒有冒號的句子照留。 */
export function shownRuleLines(lines: readonly string[]): string[] {
  return lines.filter((line) => {
    const cut = line.indexOf('：');
    if (cut < 0) return true;
    return line.slice(cut + 1).trim() !== copy.unset;
  });
}

function RuleBlock({
  title,
  rows,
}: {
  title: string;
  rows: readonly { text: string; fit?: boolean }[];
}): JSX.Element | null {
  const shown = rows.filter((row) => shownRuleLines([row.text]).length > 0);
  if (shown.length === 0) return null;
  return (
    <section class="s4b-sub">
      <h3 class="s4b-h">{title}</h3>
      {shown.map((row) => <Line key={row.text} text={row.text} fit={row.fit} />)}
    </section>
  );
}

export function RulesPublicScreen({
  timeout = S4B_PUBLISHED.timeout,
}: {
  timeout?: S4bTimeout;
} = {}): JSX.Element {
  const fair = S4B_PUBLISHED.fair;
  const tieRows = [
    { text: copy.algo1 },
    { text: copy.algo2 },
    ...S4B_TIEBREAK.flatMap((key, index) => {
      if (key === 'fairPlay') {
        return [
          // 顧問 §3.306-4：第 8 項緊接一行標明「記牌功能上線後生效」（不縮字級，避免 360 寬字級不一致）
          { text: copy.rank(index + 1, criterionLabel[key]) },
          { text: `${copy.fairLater}・${copy.fairHint}` },
        ];
      }
      return [{ text: copy.rank(index + 1, criterionLabel[key]) }];
    }),
  ];
  const fairLines = shownRuleLines([
    copy.cardLine(cardWeightLabel.yellow, formatSigned(fair.yellow)),
    copy.cardLine(cardWeightLabel.secondYellow, formatSigned(fair.secondYellow)),
    copy.cardLine(cardWeightLabel.directRed, formatSigned(fair.directRed)),
    copy.cardLine(cardWeightLabel.yellowThenRed, formatSigned(fair.yellowThenRed)),
  ]);
  return (
    <S4bFrame title={copy.rulesPublicTitle} screen="rules-public">
      <S4bCard>
        <h2 class="s4b-h">{copy.sysCalc}</h2>
        <RuleBlock
          title={copy.pointsTitle}
          rows={[
            { text: copy.winLine(S4B_PUBLISHED.win) },
            { text: copy.drawLine(S4B_PUBLISHED.draw) },
            { text: copy.lossLine(S4B_PUBLISHED.loss) },
          ]}
        />
        <RuleBlock title={copy.tieTitle} rows={tieRows} />
        <RuleBlock
          title={copy.walkTitle}
          rows={[
            { text: copy.woScore(S4B_PUBLISHED.woAgainst, S4B_PUBLISHED.woFor) },
            { text: copy.woPoints(S4B_PUBLISHED.award, S4B_PUBLISHED.penalty) },
            { text: copy.woGoals },
          ]}
        />
        <RuleBlock title={copy.mercyTitle} rows={[{ text: copy.mercyOff }]} />
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.fairTitle}</h3>
          <p class="s4b-status">{copy.fairLater}</p>
          {fairLines.map((text) => <Line key={text} text={text} />)}
        </section>
      </S4bCard>
      <S4bCard>
        <h2 class="s4b-h">{copy.hostDoes}</h2>
        <RuleBlock title={copy.subTitle} rows={[{ text: copy.subLine }]} />
        {/* 關閉時沒有列，整區連標題一起不畫。長句用較小字級，360 寬不斷在詞中間。 */}
        <RuleBlock
          title={copy.timeoutTitle}
          rows={publicTimeoutLines(timeout).map((text) => ({ text }))}
        />
        <RuleBlock title={copy.lateTitle} rows={[{ text: copy.lateLine }]} />
        <RuleBlock title={copy.suspTitle} rows={[{ text: copy.suspLine }]} />
        <RuleBlock
          title={copy.kitTitle}
          rows={[{ text: copy.shinLine }, { text: copy.colorLine }, { text: copy.numLine }]}
        />
        <RuleBlock title={copy.appealTitle} rows={[{ text: copy.appealLine }]} />
      </S4bCard>
    </S4bFrame>
  );
}
