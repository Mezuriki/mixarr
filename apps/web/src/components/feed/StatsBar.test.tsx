import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsBar } from './StatsBar';

/** Match an element whose full textContent (whitespace-collapsed) equals `text`. */
function byTextContent(text: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() === text;
}

describe('StatsBar', () => {
  it('renders pending count', () => {
    render(<StatsBar pending={5} addedToday={0} />);
    expect(screen.getByText(byTextContent('5 pending'))).toBeInTheDocument();
  });

  it('renders addedToday count', () => {
    render(<StatsBar pending={0} addedToday={3} />);
    expect(screen.getByText(byTextContent('3 added today'))).toBeInTheDocument();
  });

  it('renders zero counts correctly', () => {
    render(<StatsBar pending={0} addedToday={0} />);
    expect(screen.getByText(byTextContent('0 pending'))).toBeInTheDocument();
    expect(screen.getByText(byTextContent('0 added today'))).toBeInTheDocument();
  });

  it('renders large numbers correctly', () => {
    render(<StatsBar pending={1234} addedToday={5678} />);
    expect(screen.getByText(byTextContent('1234 pending'))).toBeInTheDocument();
    expect(screen.getByText(byTextContent('5678 added today'))).toBeInTheDocument();
  });
});
