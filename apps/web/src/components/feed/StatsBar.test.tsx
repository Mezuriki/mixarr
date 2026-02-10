import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsBar } from './StatsBar';

describe('StatsBar', () => {
  it('renders pending count', () => {
    render(<StatsBar pending={5} addedToday={0} />);
    expect(screen.getByText('5 pending')).toBeInTheDocument();
  });

  it('renders addedToday count', () => {
    render(<StatsBar pending={0} addedToday={3} />);
    expect(screen.getByText('3 added today')).toBeInTheDocument();
  });

  it('renders zero counts correctly', () => {
    render(<StatsBar pending={0} addedToday={0} />);
    expect(screen.getByText('0 pending')).toBeInTheDocument();
    expect(screen.getByText('0 added today')).toBeInTheDocument();
  });

  it('renders large numbers correctly', () => {
    render(<StatsBar pending={1234} addedToday={5678} />);
    expect(screen.getByText('1234 pending')).toBeInTheDocument();
    expect(screen.getByText('5678 added today')).toBeInTheDocument();
  });
});
