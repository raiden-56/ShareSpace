import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Card, CardContent, Link, Stack, Typography } from '@mui/material';
import {
  BellRing,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  Compass,
  Contact,
  Globe,
  HandCoins,
  MessageCircleQuestion,
  Receipt,
  Repeat,
  Rocket,
  Scale,
  ShieldCheck,
  Shuffle,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, PageTransition } from '../components/common/Layout';
import { useTour } from '../components/tour/tourContext';

/** A short worked example, set apart from the explanation around it. */
function Example({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        my: 1.5,
        px: 2,
        py: 1.5,
        borderRadius: 2,
        borderLeft: 3,
        borderColor: 'primary.main',
        bgcolor: 'surface.subtle',
        '& p + p': { mt: 0.75 },
      }}
    >
      <Typography variant="overline" component="p" sx={{ color: 'text.secondary' }}>
        Example
      </Typography>
      {children}
    </Box>
  );
}

const P = ({ children }: { children: ReactNode }) => (
  <Typography variant="body2" sx={{ mb: 1.25, color: 'text.primary', lineHeight: 1.65 }}>
    {children}
  </Typography>
);

const Steps = ({ items }: { items: ReactNode[] }) => (
  <Box component="ol" sx={{ pl: 2.5, my: 1, '& li': { mb: 0.75, typography: 'body2', lineHeight: 1.6 } }}>
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </Box>
);

const Bullets = ({ items }: { items: ReactNode[] }) => (
  <Box component="ul" sx={{ pl: 2.5, my: 1, '& li': { mb: 0.75, typography: 'body2', lineHeight: 1.6 } }}>
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </Box>
);

const Ex = ({ children }: { children: ReactNode }) => (
  <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
    {children}
  </Typography>
);

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: Rocket,
    body: (
      <>
        <P>ShareSpace keeps track of shared costs so everyone pays their fair share. The usual flow is:</P>
        <Steps
          items={[
            'Create a group (a trip, your flat, a dinner) and add the people in it.',
            'Add expenses as they happen: who paid, how much, and who it was for.',
            'Check Balances to see who owes whom. ShareSpace nets everything into as few repayments as possible.',
            'When someone pays someone back, record the repayment so the balances update.',
          ]}
        />
        <P>
          Use <strong>Add expense</strong> in the header (or the + button at the bottom on a phone) from any page. Press <strong>Ctrl+K</strong> or{' '}
          <strong>/</strong> to search expenses, groups, plans and people.
        </P>
      </>
    ),
  },
  {
    id: 'groups',
    title: 'Groups and members',
    icon: Users,
    body: (
      <>
        <P>
          A group has a name, a type and a currency. Every expense, repayment, budget and plan belongs to one group, and only its members can see
          it.
        </P>
        <Bullets
          items={[
            <>
              <strong>Add people by name</strong> straight away, even if they have no account. They can be included in expenses immediately.
            </>,
            <>
              <strong>Invite by email</strong> to get an invitation link that you share yourself (ShareSpace does not send email). Links expire after
              7 days. When the person accepts, they take over the history of the name you added for them.
            </>,
            <>
              <strong>Roles</strong>: Owners and Admins manage members and settings; Members add and edit expenses and repayments; Viewers can only
              look. Only the Owner can change roles or archive the group.
            </>,
            <>
              <strong>Archiving</strong> makes a finished group read-only. You can restore it later.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'expenses',
    title: 'Adding expenses and splitting them',
    icon: Receipt,
    body: (
      <>
        <P>
          Each expense records what it was, the amount, the date, a category, <strong>who paid</strong> and <strong>how it is split</strong>. You
          can add notes, comments and receipts (photos or PDFs, up to 10 MB). Edits are kept in the expense&apos;s history, and deleted expenses can
          be restored.
        </P>
        <P>Choose the split method that matches what happened:</P>
        <Bullets
          items={[
            <>
              <strong>Equally</strong>: everyone selected pays the same.
              <Example>
                <Ex>₹900 dinner for Asha, Ben and Chen → ₹300 each.</Ex>
              </Example>
            </>,
            <>
              <strong>Exact amounts</strong>: type each person&apos;s amount; they must add up to the total.
              <Example>
                <Ex>₹1,000 groceries: Asha ₹600, Ben ₹400.</Ex>
              </Example>
            </>,
            <>
              <strong>Percentages</strong>: must add up to 100%.
              <Example>
                <Ex>₹2,000 rent top-up: Asha 60% = ₹1,200, Ben 40% = ₹800.</Ex>
              </Example>
            </>,
            <>
              <strong>Shares</strong>: split by weight, such as nights stayed or people in a family.
              <Example>
                <Ex>₹3,000 villa: Asha 2 shares, Ben 1 share → Asha ₹2,000, Ben ₹1,000.</Ex>
              </Example>
            </>,
            <>
              <strong>Adjustment</strong>: an equal split, plus extra amounts charged to particular people.
              <Example>
                <Ex>₹1,000 taxi, Ben added a ₹100 detour: ₹900 split two ways = ₹450 each, so Asha ₹450 and Ben ₹550.</Ex>
              </Example>
            </>,
            <>
              <strong>Itemised</strong>: assign each item on the bill to the people who had it. Tax and service charge are shared in proportion to
              what each person ordered, and so is any discount.
              <Example>
                <Ex>Pizza ₹600 (Asha and Ben), juice ₹200 (Ben), 10% service ₹80 → Asha ₹300 + ₹30 = ₹330, Ben ₹500 + ₹50 = ₹550.</Ex>
              </Example>
            </>,
            <>
              <strong>Several payers</strong>: if two people paid at the till, enter how much each paid. Their amounts must add up to the total.
              <Example>
                <Ex>₹1,500 bill paid ₹1,000 by Asha and ₹500 by Ben, split equally between Asha, Ben and Chen: each share is ₹500, so Chen owes Asha ₹500.</Ex>
              </Example>
            </>,
          ]}
        />
        <P>
          Amounts are exact to the paisa. When a total cannot be divided evenly, the leftover paise go to the first people in the list, so
          shares always add up exactly.
        </P>
      </>
    ),
  },
  {
    id: 'balances',
    title: 'How balances are calculated',
    icon: Scale,
    body: (
      <>
        <P>
          Every expense and repayment in a group is combined into one balance per person, so you never have to pay back expense by expense. For
          each person:
        </P>
        <Box component="p" sx={{ typography: 'body2', fontWeight: 650, my: 1.5, px: 2, py: 1, borderRadius: 2, bgcolor: 'surface.sage' }}>
          net = paid − share + repayments sent − repayments received
        </Box>
        <P>A positive net means the group owes you; a negative net means you owe the group. The nets always add up to zero.</P>
        <Example>
          <Ex>You pay ₹200 for something you both share, and your friend pays ₹100 for something you both share.</Ex>
          <Ex>Total ₹300, so each share is ₹150. You paid ₹200, so you are owed ₹50: your friend pays you ₹50 and you are even.</Ex>
        </Example>
        <Example>
          <Ex>You pay ₹200 that was entirely for your friend, and your friend pays ₹100 that was entirely for you.</Ex>
          <Ex>Your friend owes you ₹200 and you owe them ₹100, which nets to one payment: your friend pays you ₹100.</Ex>
        </Example>
        <P>Balances are worked out from the recorded expenses and repayments every time, so editing or deleting an expense updates them straight away.</P>
      </>
    ),
  },
  {
    id: 'simplify',
    title: 'Simplify debts: on or off',
    icon: Shuffle,
    body: (
      <>
        <P>Each group has a <strong>Simplify debts</strong> setting in its settings.</P>
        <Bullets
          items={[
            <>
              <strong>On (default)</strong>: ShareSpace suggests the fewest repayments that settle everyone, even between people who never paid for
              each other directly.
            </>,
            <>
              <strong>Off</strong>: each debt stays between the two people it came from, netted per pair.
            </>,
          ]}
        />
        <Example>
          <Ex>Asha paid ₹500 for Ben, and Ben paid ₹500 for Chen.</Ex>
          <Ex>On: Chen pays Asha ₹500 (one repayment). Off: Ben pays Asha ₹500 and Chen pays Ben ₹500.</Ex>
        </Example>
        <P>Everyone&apos;s net balance is identical either way. Only the suggested repayments differ.</P>
      </>
    ),
  },
  {
    id: 'settling',
    title: 'Settling up',
    icon: HandCoins,
    body: (
      <>
        <P>
          When someone pays someone back by cash, UPI, bank transfer or any other way, record it with <strong>Record repayment</strong> or <strong>Settle up</strong>. ShareSpace
          only keeps the record. It never moves money, so make the actual payment in your usual app.
        </P>
        <Bullets
          items={[
            'Suggested repayments are filled in for you, and you can change the amount for a partial payment. The preview shows what everyone will owe afterwards.',
            'You are warned before recording more than someone owes.',
            'A repayment recorded by mistake can be reversed with a reason. It stays in the history, marked as reversed, and stops counting.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'friends',
    title: 'Friends and expenses outside groups',
    icon: Contact,
    body: (
      <>
        <P>
          <strong>Friends</strong> lists everyone you share a group with, with one total per person across all those groups. Open a friend to see the
          balance in each group, your shared expenses and the repayments between you.
        </P>
        <Bullets
          items={[
            <>
              <strong>Settle up in one step</strong>: paying the whole total records a repayment in every group, including groups where the debt runs
              the other way, so every group ends at zero. A smaller amount pays off the largest debts first.
            </>,
            <>
              <strong>Remind</strong> a friend who owes you. They get an in-app notification, at most once a day.
            </>,
            <>
              <strong>Expenses outside any group</strong>: for friends with an account, add expenses just between the two of you. They go into a
              private two-person group that nobody else can join.
            </>,
          ]}
        />
        <P>Balances in different currencies are shown separately and never converted.</P>
      </>
    ),
  },
  {
    id: 'repeating',
    title: 'Repeating expenses',
    icon: Repeat,
    body: (
      <>
        <P>
          For rent, subscriptions and other regular bills, choose how often an expense repeats: every week, every 2 weeks, every month, every 3
          months or every year. Each repeat is a normal expense you can edit or delete on its own.
        </P>
        <Bullets
          items={[
            'Repeats are added when someone in the group uses ShareSpace on or after the due date. There is no background job, so a repeat can appear a little after its date.',
            'Monthly bills on the 29th to 31st fall on the last day of shorter months.',
            'To stop a series, edit the original expense and choose "Does not repeat", or delete it.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'currencies',
    title: 'Multiple currencies',
    icon: Globe,
    body: (
      <>
        <P>
          Every group has one main currency for its balances. Turn on multiple currencies in the group&apos;s settings to record expenses paid in
          another currency. You then enter the exchange rate yourself for each expense: ShareSpace does not fetch live rates.
        </P>
        <Example>
          <Ex>A €50 museum ticket in an INR group at a rate of 90 is recorded as ₹4,500. The original €50 and the rate stay on the expense.</Ex>
        </Example>
      </>
    ),
  },
  {
    id: 'budgets',
    title: 'Budgets',
    icon: Wallet,
    body: (
      <P>
        Set a total budget for a group, optionally per category and for a date range. ShareSpace shows how much is spent and left, and sends an in-app
        alert when spending passes your warning level (80% by default) and again if it goes over. Repayments never count as spending.
      </P>
    ),
  },
  {
    id: 'plans',
    title: 'Plans, events and polls',
    icon: CalendarDays,
    body: (
      <P>
        Plans keep a trip or event together: dates, place, participants, an estimated budget, an itinerary and a checklist you can reorder by dragging.
        Link expenses to a plan to compare actual spending with the estimate. Polls let the group vote on options such as dates or places, with an
        optional deadline and one vote per person.
      </P>
    ),
  },
  {
    id: 'reports',
    title: 'Reports and exports',
    icon: ChartColumn,
    body: (
      <P>
        Reports show spending by category, by person and over time, for one group or all of them. Every chart can be switched to a table. Download expenses,
        repayments and reports as CSV files, or a full backup of a group. Your own data export is in Settings → Data.
      </P>
    ),
  },
  {
    id: 'notifications',
    title: 'Notifications and reminders',
    icon: BellRing,
    body: (
      <P>
        Notifications appear inside ShareSpace (the bell in the header): new or changed expenses, comments, repayments, payment reminders, budget
        alerts, upcoming plans and poll deadlines. No email or push notifications are sent. Choose what you get in Settings → Notifications.
      </P>
    ),
  },
  {
    id: 'privacy',
    title: 'Privacy and security',
    icon: ShieldCheck,
    body: (
      <Bullets
        items={[
          "Only members of a group can see it. To anyone else, a group's link looks like it does not exist.",
          'Receipts are stored privately and only shown to members of the group.',
          'See every device you are signed in on, and sign out the others, in Settings → Sessions.',
          'You can download your data or delete your account in Settings.',
        ]}
      />
    ),
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Does ShareSpace send or receive money?',
    a: 'No. It records who owes whom and the repayments you tell it about. Pay each other with cash, UPI or your bank as usual, then record the repayment.',
  },
  {
    q: 'Why does the suggested repayment involve someone I never paid for?',
    a: 'With Simplify debts on, ShareSpace finds the fewest repayments that settle everyone. Turn it off in the group settings to keep each debt between the two people involved.',
  },
  {
    q: 'Can I add someone who does not have an account?',
    a: 'Yes. Add them by name and include them in expenses. Later, invite them by email; when they accept, the history under their name becomes theirs.',
  },
  {
    q: 'I recorded a repayment by mistake. Can I delete it?',
    a: 'Repayments are never deleted, so the history stays trustworthy. Reverse it instead, with a reason: it stops counting towards balances.',
  },
  {
    q: 'Why did an expense repeat a few days late?',
    a: 'Repeats are added the next time someone in the group opens ShareSpace on or after the due date. Each one keeps its scheduled date.',
  },
  {
    q: 'Why are my totals shown in two currencies?',
    a: 'Groups can use different currencies. ShareSpace keeps each currency separate rather than converting at a rate you did not choose.',
  },
  {
    q: 'I forgot my password.',
    a: 'Use "Forgot password" on the sign-in page. This installation does not send email, so ask the person who runs your ShareSpace to help you reset it.',
  },
];

export default function Help() {
  const tour = useTour();
  return (
    <PageTransition>
      <PageHeader title="Help & guide" subtitle="How ShareSpace works, with worked examples for every feature." />

      <Card sx={{ mb: 3, bgcolor: 'surface.sage', border: 0 }}>
        <CardContent sx={{ p: { xs: 2.25, sm: 3 }, '&:last-child': { pb: { xs: 2.25, sm: 3 } } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Box>
              <Typography variant="h3" component="h2">
                New to ShareSpace?
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, color: 'text.primary' }}>
                Take the one-minute guided tour of the main screens, or read the guide below.
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<Compass size={18} />} onClick={tour.start} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}>
              Take the tour
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr)' }, alignItems: 'start' }}>
        <Box component="nav" aria-label="Guide contents" sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
          <Typography variant="overline" component="h2" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            Contents
          </Typography>
          <Box
            component="ul"
            sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexWrap: { xs: 'wrap', md: 'nowrap' }, flexDirection: { md: 'column' }, gap: { xs: 0.75, md: 0.25 } }}
          >
            {[...SECTIONS.map((s) => ({ id: s.id, title: s.title })), { id: 'faq', title: 'FAQ' }].map((s) => (
              <li key={s.id}>
                <Link
                  href={`#${s.id}`}
                  underline="hover"
                  sx={{
                    display: 'inline-block',
                    typography: 'body2',
                    fontWeight: 550,
                    py: { xs: 0.5, md: 0.6 },
                    px: { xs: 1.25, md: 1 },
                    borderRadius: { xs: 5, md: 1.5 },
                    border: { xs: 1, md: 0 },
                    borderColor: 'divider',
                    color: 'text.primary',
                  }}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </Box>
        </Box>

        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          {SECTIONS.map(({ id, title, icon: Icon, body }) => (
            <Card key={id} component="section" id={id} aria-labelledby={`${id}-title`} sx={{ scrollMarginTop: 88 }}>
              <CardContent sx={{ p: { xs: 2.25, sm: 3 }, '&:last-child': { pb: { xs: 2.25, sm: 3 } } }}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'surface.sage', color: 'primary.main', flexShrink: 0 }} aria-hidden>
                    <Icon size={19} />
                  </Box>
                  <Typography id={`${id}-title`} variant="h3" component="h2">
                    {title}
                  </Typography>
                </Stack>
                {body}
              </CardContent>
            </Card>
          ))}

          <Card component="section" id="faq" aria-labelledby="faq-title" sx={{ scrollMarginTop: 88 }}>
            <CardContent sx={{ p: { xs: 2.25, sm: 3 }, '&:last-child': { pb: { xs: 2.25, sm: 3 } } }}>
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'surface.sage', color: 'primary.main', flexShrink: 0 }} aria-hidden>
                  <MessageCircleQuestion size={19} />
                </Box>
                <Typography id="faq-title" variant="h3" component="h2">
                  FAQ
                </Typography>
              </Stack>
              {FAQ.map(({ q, a }) => (
                <Accordion key={q} disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&::before': { bgcolor: 'divider' } }}>
                  <AccordionSummary expandIcon={<ChevronDown size={18} />} sx={{ px: 0, '& .MuiAccordionSummary-content': { my: 1.25 } }}>
                    <Typography variant="subtitle1" component="h3">
                      {q}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0, pt: 0 }}>
                    <Typography variant="body2" sx={{ lineHeight: 1.65 }}>
                      {a}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              ))}
            </CardContent>
          </Card>

          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Still stuck? Check your preferences in{' '}
            <Link component={RouterLink} to="/settings">
              Settings
            </Link>{' '}
            or replay the tour from the top of this page.
          </Typography>
        </Stack>
      </Box>
    </PageTransition>
  );
}
