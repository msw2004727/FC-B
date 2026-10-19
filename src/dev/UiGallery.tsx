import './ui-gallery.css';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { Icon, type IconName } from '@/ui/Icon';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Heading } from '@/ui/Heading';
import { Card } from '@/ui/Card';
import { ListRow } from '@/ui/ListRow';
import { Chip } from '@/ui/Chip';
import { Badge } from '@/ui/Badge';
import { Skeleton } from '@/ui/Skeleton';
import { EmptyState } from '@/ui/EmptyState';
import { Avatar } from '@/ui/Avatar';
import { UserTag } from '@/ui/UserTag';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { Checkbox } from '@/ui/Checkbox';
import { Radio } from '@/ui/Radio';
import { RadioGroup } from '@/ui/RadioGroup';
import { Switch } from '@/ui/Switch';
import { Stepper } from '@/ui/Stepper';
import { DateTime } from '@/ui/DateTime';
import { Tabs } from '@/ui/Tabs';
import { Modal } from '@/ui/Modal';
import { BottomSheet } from '@/ui/BottomSheet';
import { TopBar } from '@/ui/TopBar';
import { BottomNav } from '@/ui/BottomNav';
import { SideDrawer } from '@/ui/SideDrawer';
import { Toast, toast, type ToastTone } from '@/ui/Toast';
import { ToastHost } from '@/ui/ToastHost';
import { DataTable, type DataTableColumn } from '@/ui/DataTable';
import { getCurrentLocale, useT } from '@/i18n/i18n';

interface SectionProps {
  name: string;
  children: ComponentChildren;
}

function Section({ name, children }: SectionProps) {
  return (
    <section class="ui-gallery__section" aria-label={name}>
      <h2 class="ui-gallery__heading"><Text>{name}</Text></h2>
      <div class="ui-gallery__examples">{children}</div>
    </section>
  );
}

interface DemoRow {
  id: string;
  name: string;
  count: number;
}

const tones: readonly ToastTone[] = ['success', 'error', 'info', 'warning'];
const states = ['default', 'disabled', 'error', 'loading', 'long'] as const;
type DemoState = typeof states[number];

function FormExamples({ state }: { state: DemoState }) {
  const t = useT();
  const sample = t('ui.gallery.sample');
  const long = Array.from({ length: 12 }, () => sample).join(' ');
  const label = state === 'long' ? long : t('ui.gallery.field');
  const [text, setText] = useState(state === 'long' ? long : '');
  const [selection, setSelection] = useState('first');
  const [checked, setChecked] = useState(false);
  const [radio, setRadio] = useState('first');
  const [enabled, setEnabled] = useState(false);
  const [quantity, setQuantity] = useState(2);
  const disabled = state === 'disabled';
  const loading = state === 'loading';
  const error = state === 'error' ? t('ui.gallery.error') : undefined;
  const options = [
    { value: 'first', label: t('ui.gallery.firstTab') },
    { value: 'second', label: t('ui.gallery.secondTab') },
    { value: 'unavailable', label: sample, disabled: true },
  ];

  return (
    <div class="ui-gallery__stack">
      <Text>{state}</Text>
      <Input
        label={label}
        value={text}
        onValueChange={setText}
        disabled={disabled}
        loading={loading}
        error={error}
        required
      />
      <Select
        label={label}
        value={selection}
        options={options}
        onValueChange={setSelection}
        disabled={disabled}
        loading={loading}
        error={error}
      />
      {(['auto-grow', 'fixed'] as const).map((variant) => (
        <Textarea
          key={variant}
          label={`${label} · ${variant}`}
          variant={variant}
          value={text}
          onValueChange={setText}
          disabled={disabled}
          loading={loading}
          error={error}
          maxLength={100}
        />
      ))}
      <Checkbox
        label={label}
        checked={checked}
        onCheckedChange={setChecked}
        disabled={disabled}
        loading={loading}
        error={error}
      />
      <Radio
        name={`gallery-radio-${state}`}
        value="first"
        label={label}
        checked={radio === 'first'}
        onCheckedChange={(next) => { if (next) setRadio('first'); }}
        disabled={disabled}
        loading={loading}
        error={error}
      />
      <Radio
        name={`gallery-radio-${state}`}
        value="second"
        label={t('ui.gallery.secondTab')}
        checked={radio === 'second'}
        onCheckedChange={(next) => { if (next) setRadio('second'); }}
        disabled={disabled}
        loading={loading}
        error={error}
      />
      {(['vertical', 'horizontal'] as const).map((orientation) => (
        <RadioGroup
          key={orientation}
          label={`${label} · ${orientation}`}
          value={selection}
          options={options}
          onValueChange={setSelection}
          orientation={orientation}
          disabled={disabled}
          loading={loading}
          error={error}
        />
      ))}
      <Switch
        label={label}
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={disabled}
        loading={loading}
      />
      {(['md', 'lg'] as const).map((size) => (
        <Stepper
          key={size}
          label={label}
          value={quantity}
          onValueChange={setQuantity}
          min={0}
          max={5}
          step={0.5}
          size={size}
          disabled={disabled}
          loading={loading}
        />
      ))}
    </div>
  );
}

function TabExamples() {
  const t = useT();
  const [value, setValue] = useState('activities');
  const long = Array.from({ length: 12 }, () => t('ui.gallery.sample')).join(' ');
  const items = [
    {
      id: 'activities',
      label: t('ui.gallery.firstTab'),
      panel: <Text>{t('ui.gallery.sample')}</Text>,
    },
    { id: 'roster', label: long, panel: <Text>{long}</Text> },
    {
      id: 'disabled',
      label: t('ui.gallery.secondTab'),
      panel: <Text>{t('ui.gallery.sample')}</Text>,
      disabled: true,
    },
  ];

  return (
    <>
      {(['underline', 'pill', 'segmented'] as const).map((variant) => (
        <Tabs
          key={variant}
          label={`Tabs · ${variant}`}
          variant={variant}
          items={items}
          value={value}
          onValueChange={setValue}
        />
      ))}
      <Tabs
        label="Tabs · disabled"
        items={items}
        value={value}
        onValueChange={setValue}
        disabled
      />
      <Tabs
        label="Tabs · loading"
        items={items}
        value={value}
        onValueChange={setValue}
        loading
      />
    </>
  );
}

function OverlayExamples() {
  const t = useT();
  const [active, setActive] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const long = Array.from({ length: 12 }, () => t('ui.gallery.sample')).join(' ');

  return (
    <>
      {(['modal', 'sheet'] as const).flatMap((kind) =>
        (['sm', 'md', 'lg'] as const).flatMap((size) =>
          (['default', 'loading', 'error', 'long'] as const).map((state) => {
            const id = `${kind}-${size}-${state}`;
            const Frame = kind === 'modal' ? Modal : BottomSheet;
            const title = state === 'long'
              ? long
              : t(kind === 'modal' ? 'ui.gallery.openModal' : 'ui.gallery.openSheet');

            return (
              <div key={id}>
                <Button onClick={() => setActive(id)}>
                  {`${title} · ${size} · ${state}`}
                </Button>
                <Frame
                  open={active === id}
                  title={title}
                  size={size}
                  loading={state === 'loading'}
                  error={state === 'error' ? t('ui.gallery.error') : undefined}
                  onClose={() => setActive(null)}
                  footer={
                    <Button onClick={() => setActive(null)}>
                      {t('ui.gallery.close')}
                    </Button>
                  }
                >
                  <Input
                    label={t('ui.gallery.field')}
                    value={value}
                    onValueChange={setValue}
                  />
                  {Array.from({ length: state === 'long' ? 24 : 1 }, (_, index) => (
                    <Text key={index} as="p">{long}</Text>
                  ))}
                </Frame>
              </div>
            );
          }),
        ),
      )}
    </>
  );
}

/** 開發展示頁；由既有應用的 LocationProvider 提供路由環境。 */
export default function UiGallery() {
  const t = useT();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [hiddenTones, setHiddenTones] = useState<readonly ToastTone[]>([]);
  const [chipSelected, setChipSelected] = useState(false);
  const [chipVisible, setChipVisible] = useState(true);
  const [rowSelected, setRowSelected] = useState(false);
  const [mixed, setMixed] = useState(true);
  const [checked, setChecked] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  const sample = t('ui.gallery.sample');
  const action = t('ui.gallery.action');
  const field = t('ui.gallery.field');
  const long = Array.from({ length: 12 }, () => sample).join(' ');
  const rows: DemoRow[] = [
    { id: 'demo-1', name: sample, count: 12 },
    { id: 'demo-2', name: long, count: 3 },
  ];
  const collator = new Intl.Collator(getCurrentLocale());
  const columns: DataTableColumn<DemoRow>[] = [
    {
      id: 'name',
      header: field,
      value: (row) => row.name,
      compare: (a, b) => collator.compare(a.name, b.name),
    },
    {
      id: 'count',
      header: t('ui.gallery.count'),
      value: (row) => row.count,
      compare: (a, b) => a.count - b.count,
      numeric: true,
    },
  ];
  const icons: readonly IconName[] = [
    'home', 'calendar', 'qr', 'user', 'users', 'book',
    'inbox', 'settings', 'sun', 'moon', 'globe',
  ];

  return (
    <main class="ui-gallery">
      <Heading level={1}>{t('ui.gallery.title')}</Heading>

      <Section name="Button / IconButton">
        {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
          <div key={variant} class="ui-gallery__stack">
            {(['sm', 'md', 'lg'] as const).map((size) => (
              <Button key={size} variant={variant} size={size}>{action}</Button>
            ))}
            <Button variant={variant} disabled>{action}</Button>
            <Button variant={variant} loading>{action}</Button>
            <Button variant={variant}>{long}</Button>
            <IconButton label={action} name="calendar" variant={variant} />
            <IconButton label={action} name="calendar" variant={variant} disabled />
          </div>
        ))}
        <Button href="#gallery-text">{action}</Button>
        <Button leading={<Icon name="calendar" />} trailing={<Icon name="user" />}>
          {action}
        </Button>
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <IconButton key={size} label={long} name="settings" size={size} />
        ))}
      </Section>

      <Section name="Heading / Text / Icon">
        <div id="gallery-text">
          {(['title', 'title-lg', 'display'] as const).map((size) => (
            <Heading key={size} level={3} size={size}>{long}</Heading>
          ))}
          <Text as="p">{long}</Text>
          <Text>{'FC-B · zh-TW · 2026-10-19'}</Text>
        </div>
        {icons.map((name) => (
          <span key={name}>
            <Icon name={name} size={24} />
            <Text>{name}</Text>
          </span>
        ))}
      </Section>

      <Section name="Card / ListRow">
        {(['default', 'outlined', 'elevated'] as const).map((variant) => (
          <Card key={variant} variant={variant}><Text>{long}</Text></Card>
        ))}
        {(['none', 'sm', 'md', 'lg'] as const).map((padding) => (
          <Card key={padding} padding={padding}><Text>{sample}</Text></Card>
        ))}
        <Card variant="interactive" onClick={() => setProfile('ui-gallery-demo')}>
          <Text>{action}</Text>
        </Card>
        <Card variant="interactive" disabled><Text>{action}</Text></Card>
        <Card href="#gallery-text"><Text>{action}</Text></Card>
        <ul class="ui-gallery__list">
          <ListRow title={sample} subtitle={long} leading={<Avatar name={sample} />} />
          <ListRow
            title={long}
            subtitle={sample}
            selected={rowSelected}
            onClick={() => setRowSelected((value) => !value)}
            trailing={<Badge label={sample} />}
          />
          <ListRow title={sample} href="#gallery-text" />
          <ListRow title={sample} onClick={() => setRowSelected(true)} disabled />
        </ul>
      </Section>

      <Section name="Chip / Badge">
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {(['outline', 'soft', 'solid'] as const).map((variant) => (
            <Chip
              key={variant}
              label={long}
              description={sample}
              icon="calendar"
              variant={variant}
              selected={chipSelected}
              onSelect={setChipSelected}
            />
          ))}
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Chip key={size} label={sample} size={size} />
          ))}
          <Chip label={sample} selected={chipSelected} onSelect={setChipSelected} disabled />
          <Chip label={sample} selected={chipSelected} onSelect={setChipSelected} loading />
          {chipVisible ? (
            <Chip
              label={sample}
              selected={chipSelected}
              onSelect={setChipSelected}
              onRemove={() => setChipVisible(false)}
            />
          ) : (
            <Button onClick={() => setChipVisible(true)}>{t('common.retry')}</Button>
          )}
          <Chip />
          {(['neutral', 'brand', 'success', 'warning', 'danger', 'info'] as const).map((tone) =>
            (['soft', 'solid', 'outline'] as const).map((variant) => (
              <Badge key={`${tone}-${variant}`} tone={tone} variant={variant} label={sample} />
            )),
          )}
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <Badge key={size} size={size} label={long} />
          ))}
          <Badge label={sample} disabled />
          <Badge />
        </div>
      </Section>

      <Section name="Skeleton / EmptyState">
        <div aria-busy="true">
          <Skeleton />
          <Skeleton lines={2} />
          <Skeleton shape="rect" width="100%" height={120} />
          <Skeleton shape="circle" width={44} height={44} />
        </div>
        <EmptyState />
        <EmptyState
          title={t('ui.gallery.empty')}
          body={long}
          icon={<Icon name="inbox" size={48} />}
          action={<Button onClick={() => setProfile('ui-gallery-demo')}>{action}</Button>}
        />
        <EmptyState title={long} body={long} icon={null} />
      </Section>

      <Section name="Avatar / UserTag">
        {(['user', 'coach', 'captain', 'team_leader', 'venue_owner', 'admin', 'super_admin'] as const).map((role) => (
          <div key={role}>
            <Avatar name={sample} role={role} size="lg" />
            <UserTag
              uid={`ui-gallery-${role}`}
              name={long}
              role={role}
              level={1}
              onOpenProfile={setProfile}
            />
          </div>
        ))}
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Avatar key={size} size={size} name={sample} />
        ))}
        <Avatar />
        <Avatar name={sample} pictureUrl="data:image/png;base64,invalid" />
        <UserTag uid="ui-gallery-disabled" name={sample} disabled onOpenProfile={setProfile} />
        <UserTag uid="ui-gallery-loading" name={sample} loading onOpenProfile={setProfile} />
        <UserTag
          uid="ui-gallery-warning"
          attendanceFill={{ pct: 40, color: 'rgba(239,68,68,.45)', noShow: 2, ended: 5 }}
          recentNoShow
          onOpenProfile={setProfile}
        />
        <Modal open={profile !== null} title={sample} onClose={() => setProfile(null)}>
          <Text>{profile ?? ''}</Text>
        </Modal>
      </Section>

      <Section name="Input / Select / Textarea / Checkbox / Radio / RadioGroup / Switch / Stepper">
        {states.map((state) => <FormExamples key={state} state={state} />)}
        <Checkbox
          label={sample}
          checked={checked}
          indeterminate={mixed}
          onCheckedChange={(next) => {
            setMixed(false);
            setChecked(next);
          }}
        />
      </Section>

      <Section name="DateTime">
        {(['date', 'time', 'datetime', 'relative'] as const).map((variant) => (
          <DateTime
            key={variant}
            variant={variant}
            value="2026-10-19T09:00:00+08:00"
            now={Date.parse('2026-10-19T10:00:00+08:00')}
          />
        ))}
        <DateTime value="invalid" />
      </Section>

      <Section name="Tabs"><TabExamples /></Section>
      <Section name="Modal / BottomSheet"><OverlayExamples /></Section>

      <Section name="TopBar / BottomNav / SideDrawer">
        <Switch
          label={t('ui.topBar.login')}
          checked={loginPending}
          onCheckedChange={setLoginPending}
        />
        <TopBar
          menuRef={menuRef}
          drawerOpen={drawer}
          onMenuClick={() => setDrawer(true)}
          onLogin={() => setProfile('ui-gallery-login')}
          loginPending={loginPending}
        />
        <SideDrawer open={drawer} onClose={() => setDrawer(false)} returnFocusRef={menuRef} />
        <BottomNav />
      </Section>

      <Section name="Toast">
        <div class="ui-gallery__stack">
          {tones.filter((tone) => !hiddenTones.includes(tone)).map((tone) => (
            <Toast
              key={tone}
              tone={tone}
              message={long}
              duration={0}
              onClose={() => setHiddenTones((current) => [...current, tone])}
            />
          ))}
        </div>
        <Button onClick={() => setHiddenTones([])}>{t('common.retry')}</Button>
        {tones.map((tone) => (
          <Button key={tone} onClick={() => toast.show({ message: long, tone })}>
            {`${t('ui.gallery.showToast')} · ${t(`ui.toast.${tone}`)}`}
          </Button>
        ))}
      </Section>

      <Section name="DataTable">
        <div class="ui-gallery__stack">
          {(['default', 'compact', 'sticky-header', 'sticky-first-col'] as const).map((variant) => (
            <DataTable
              key={variant}
              caption={`DataTable · ${variant}`}
              variant={variant}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              rowLabel={(row) => row.name}
              selectedKeys={selected}
              onSelectionChange={setSelected}
              isRowDisabled={(row) => row.id === 'demo-2'}
            />
          ))}
          <DataTable
            caption={t('ui.gallery.empty')}
            columns={columns}
            rows={[]}
            rowKey={(row) => row.id}
          />
          <DataTable
            caption={t('ui.dataTable.loading')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading
          />
          <DataTable
            caption={long}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            disabled
            truncateHeaders
            selectedKeys={selected}
            onSelectionChange={setSelected}
          />
        </div>
      </Section>

      <ToastHost />
    </main>
  );
}
