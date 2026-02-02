import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FeedCard } from './FeedCard';

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: ({ src, alt, fill, ...props }: { src: string; alt: string; fill?: boolean; [key: string]: unknown }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} data-fill={fill ? 'true' : undefined} {...props} />;
  },
}));

describe('FeedCard', () => {
  const defaultProps = {
    id: 'feed-1',
    artistName: 'Radiohead',
    imageUrl: 'https://example.com/image.jpg',
    onApprove: vi.fn(),
    onDismiss: vi.fn(),
    tags: null as string[] | null,
    listeners: null as number | null,
    subscriptionName: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders artist name', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByText('Radiohead')).toBeInTheDocument();
  });

  it('renders artist image', () => {
    render(<FeedCard {...defaultProps} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/image.jpg');
    expect(img).toHaveAttribute('alt', 'Radiohead');
  });

  it('renders placeholder when no image', () => {
    render(<FeedCard {...defaultProps} imageUrl={null} />);
    expect(screen.getByTestId('image-placeholder')).toBeInTheDocument();
  });

  it('truncates long artist names with title attribute', () => {
    const longName = 'This Is A Very Long Artist Name That Should Be Truncated';
    render(<FeedCard {...defaultProps} artistName={longName} />);
    const name = screen.getByText(longName);
    expect(name).toHaveClass('truncate');
    expect(name).toHaveAttribute('title', longName);
  });

  it('calls onApprove with id when approve button clicked', () => {
    const onApprove = vi.fn();
    render(<FeedCard {...defaultProps} onApprove={onApprove} />);
    
    fireEvent.click(screen.getByLabelText('Add to Lidarr'));
    expect(onApprove).toHaveBeenCalledWith('feed-1');
  });

  it('calls onDismiss with id when dismiss button clicked', () => {
    const onDismiss = vi.fn();
    render(<FeedCard {...defaultProps} onDismiss={onDismiss} />);
    
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('feed-1');
  });

  it('shows "Added" overlay when status is added', () => {
    render(<FeedCard {...defaultProps} status="added" />);
    expect(screen.getByText('Added')).toBeInTheDocument();
    // Buttons should not be visible
    expect(screen.queryByLabelText('Add to Lidarr')).not.toBeInTheDocument();
  });

  it('shows "Dismissed" overlay when status is dismissed', () => {
    render(<FeedCard {...defaultProps} status="dismissed" />);
    expect(screen.getByText('Dismissed')).toBeInTheDocument();
    // Buttons should not be visible
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();
  });

  it('disables buttons when loading', () => {
    render(<FeedCard {...defaultProps} isLoading />);
    expect(screen.getByLabelText('Add to Lidarr')).toBeDisabled();
    expect(screen.getByLabelText('Dismiss')).toBeDisabled();
  });

  it('has accessible button labels', () => {
    render(<FeedCard {...defaultProps} />);
    expect(screen.getByLabelText('Add to Lidarr')).toBeInTheDocument();
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
  });

  describe('metadata display', () => {
    it('displays genre tags when available', () => {
      render(<FeedCard {...defaultProps} tags={['rock', 'alternative', 'british']} />);
      expect(screen.getByText('rock')).toBeInTheDocument();
      expect(screen.getByText('alternative')).toBeInTheDocument();
      expect(screen.getByText('british')).toBeInTheDocument();
    });

    it('does not show tags section when tags is null', () => {
      render(<FeedCard {...defaultProps} tags={null} />);
      expect(screen.queryByTestId('metadata-tags')).not.toBeInTheDocument();
    });

    it('does not show tags section when tags is empty array', () => {
      render(<FeedCard {...defaultProps} tags={[]} />);
      expect(screen.queryByTestId('metadata-tags')).not.toBeInTheDocument();
    });

    it('displays listener count when available', () => {
      render(<FeedCard {...defaultProps} listeners={5000000} />);
      expect(screen.getByText('5M listeners')).toBeInTheDocument();
    });

    it('formats listener count correctly for thousands', () => {
      render(<FeedCard {...defaultProps} listeners={123456} />);
      expect(screen.getByText('123K listeners')).toBeInTheDocument();
    });

    it('formats listener count correctly for small numbers', () => {
      render(<FeedCard {...defaultProps} listeners={999} />);
      expect(screen.getByText('999 listeners')).toBeInTheDocument();
    });

    it('does not show listeners when null', () => {
      render(<FeedCard {...defaultProps} listeners={null} />);
      expect(screen.queryByText('listeners')).not.toBeInTheDocument();
    });

    it('displays subscription name when available', () => {
      render(<FeedCard {...defaultProps} subscriptionName="New Releases" />);
      expect(screen.getByText('New Releases')).toBeInTheDocument();
    });

    it('displays "Found in X subs" when multiple subscriptions', () => {
      render(<FeedCard {...defaultProps} subscriptionName="Found in 3 subs" />);
      expect(screen.getByText('Found in 3 subs')).toBeInTheDocument();
    });

    it('does not show subscription name when null', () => {
      render(<FeedCard {...defaultProps} subscriptionName={null} />);
      expect(screen.queryByTestId('metadata-source')).not.toBeInTheDocument();
    });

    it('displays all metadata on single line', () => {
      render(
        <FeedCard
          {...defaultProps}
          tags={['rock', 'alternative']}
          listeners={5000000}
          subscriptionName="New Releases"
        />
      );
      const metadataLine = screen.getByTestId('metadata-line');
      expect(metadataLine).toBeInTheDocument();
      expect(metadataLine).toHaveTextContent('rock');
      expect(metadataLine).toHaveTextContent('5M listeners');
      expect(metadataLine).toHaveTextContent('New Releases');
    });

    it('renders metadata with separator dots between sections', () => {
      render(
        <FeedCard
          {...defaultProps}
          tags={['rock']}
          listeners={1000000}
          subscriptionName="New Releases"
        />
      );
      // Check for dot separators (using · character or similar)
      const metadataLine = screen.getByTestId('metadata-line');
      expect(metadataLine.textContent).toMatch(/·|•/);
    });
  });
});
