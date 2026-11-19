// C. 規則選單補預覽。範本值照 K8：五人 2×20 中場 5、七人 2×25 中場 5、十一人 2×35 中場 10。
// 進階預設收合，由 harness 點「進階」打開。補充說明沒內容就收著。淘汰賽未支援，公開頁不印。

import type { JSX } from 'preact';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import {
  S4B_DRAFT_POINTS,
  S4B_PUBLISHED,
  S4B_TEMPLATES,
  S4B_TIEBREAK,
  formatSigned,
  pointsWarn,
  type TemplateId,
} from '../testing/step4b-fixtures';
import { cardWeightLabel, copy, criterionLabel, templateTitle } from './copy';
import { Chevron, Line, NoteSlot, S4bCard, S4bFrame } from './ui';

export function RulesTemplateScreen(): JSX.Element {
  const [picked, setPicked] = useState<TemplateId | null>(null);
  return (
    <S4bFrame title={copy.templateTitle} screen="rules-template">
      {S4B_TEMPLATES.map((item) => (
        <S4bCard key={item.id}>
          <div class="s4b-gap">
            <h2 class="s4b-h">{templateTitle[item.id]}</h2>
            <Line text={copy.playersLine(item.players)} />
            <Line text={copy.timeLine(item.half)} />
            <Line text={copy.htLine(item.halftime)} />
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

export function RulesAdvancedScreen({
  subMode = 'free',
  advancedOpen = false,
}: {
  subMode?: 'free' | 'limited';
  advancedOpen?: boolean;
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

export function RulesPublicScreen(): JSX.Element {
  const fair = S4B_PUBLISHED.fair;
  return (
    <S4bFrame title={copy.rulesPublicTitle} screen="rules-public">
      <S4bCard>
        <h2 class="s4b-h">{copy.sysCalc}</h2>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.pointsTitle}</h3>
          <Line text={copy.winLine(S4B_PUBLISHED.win)} />
          <Line text={copy.drawLine(S4B_PUBLISHED.draw)} />
          <Line text={copy.lossLine(S4B_PUBLISHED.loss)} />
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.tieTitle}</h3>
          <Line text={copy.algo1} />
          <Line text={copy.algo2} />
          {S4B_TIEBREAK.map((key, index) => (
            <Fragment key={key}>
              <Line text={copy.rank(index + 1, criterionLabel[key])} />
              {key === 'fairPlay' ? <Line text={copy.fairHint} /> : null}
            </Fragment>
          ))}
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.walkTitle}</h3>
          <Line text={copy.woScore(S4B_PUBLISHED.woAgainst, S4B_PUBLISHED.woFor)} />
          <Line text={copy.woPoints(S4B_PUBLISHED.award, S4B_PUBLISHED.penalty)} />
          <Line text={copy.woGoals} />
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.mercyTitle}</h3>
          <Line text={copy.mercyOff} />
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.fairTitle}</h3>
          <p class="s4b-status">{copy.fairLater}</p>
          <Line text={copy.cardLine(cardWeightLabel.yellow, formatSigned(fair.yellow))} />
          <Line text={copy.cardLine(cardWeightLabel.secondYellow, formatSigned(fair.secondYellow))} />
          <Line text={copy.cardLine(cardWeightLabel.directRed, formatSigned(fair.directRed))} />
          <Line text={copy.cardLine(cardWeightLabel.yellowThenRed, formatSigned(fair.yellowThenRed))} />
        </section>
      </S4bCard>
      <S4bCard>
        <h2 class="s4b-h">{copy.hostDoes}</h2>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.subTitle}</h3>
          <Line text={copy.subLine} />
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.lateTitle}</h3>
          <Line text={copy.lateLine} />
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.suspTitle}</h3>
          <Line text={copy.suspLine} />
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.kitTitle}</h3>
          <Line text={copy.shinLine} />
          <Line text={copy.colorLine} />
          <Line text={copy.numLine} />
        </section>
        <section class="s4b-sub">
          <h3 class="s4b-h">{copy.appealTitle}</h3>
          <Line text={copy.appealLine} />
        </section>
      </S4bCard>
    </S4bFrame>
  );
}
