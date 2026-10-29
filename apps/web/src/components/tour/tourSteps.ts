export interface TourStep {
  id: string;
  title: string;
  body: string;
  /**
   * `data-tour` values to point at, in order of preference. The first one that is on screen is used
   * (desktop sidebar first, then the mobile equivalent). Empty, or none visible: the step is centred.
   */
  targets: string[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ShareSpace',
    body: 'Here is a one-minute tour of the essentials. You can skip it now and replay it any time from Help & guide.',
    targets: [],
  },
  {
    id: 'groups',
    title: 'Groups',
    body: 'Create a group for a trip, your flat or a dinner. Add people by name straight away and invite them later. Each group keeps its own expenses and balances.',
    targets: ['nav-groups', 'bottom-groups'],
  },
  {
    id: 'friends',
    title: 'Friends',
    body: 'See one total per person across every group you share. Settle up with a friend in one step, send a reminder, or add expenses outside any group.',
    targets: ['nav-friends', 'bottom-friends'],
  },
  {
    id: 'add-expense',
    title: 'Add an expense',
    body: 'Pick who paid and how to split it: equally, exact amounts, percentages, shares, adjustments, or itemised with tax and tips. Bills like rent can repeat every month.',
    targets: ['add-expense', 'bottom-add'],
  },
  {
    id: 'settle',
    title: 'Balances and settling up',
    body: 'ShareSpace nets every expense. If you paid ₹200 and a friend paid ₹100 for both of you, they owe you ₹50. When money changes hands, record a repayment. ShareSpace keeps the record; it never moves money.',
    targets: ['nav-settlements', 'more-button'],
  },
  {
    id: 'search',
    title: 'Search everything',
    body: 'Find expenses, groups, plans and people. Press Ctrl+K (or /) from any page.',
    targets: ['search'],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    body: 'New expenses, repayments, payment reminders and budget alerts appear here, inside the app.',
    targets: ['notifications'],
  },
  {
    id: 'help',
    title: 'Help & guide',
    body: 'Step-by-step guides for every feature, with worked examples. Come back here to replay this tour.',
    targets: ['nav-help', 'more-button'],
  },
  {
    id: 'done',
    title: 'You are all set',
    body: 'Start by creating a group or adding your first expense. Balances update as soon as you save.',
    targets: [],
  },
];
