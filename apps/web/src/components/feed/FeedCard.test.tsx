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
});
