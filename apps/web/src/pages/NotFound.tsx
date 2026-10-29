import { Link as RouterLink } from 'react-router-dom';
import { Button, Card } from '@mui/material';
import { SearchX } from 'lucide-react';
import { EmptyState } from '../components/common/States';

export default function NotFound() {
  return (
    <Card sx={{ maxWidth: 560, mx: 'auto', mt: 4 }}>
      <EmptyState
        icon={<SearchX size={26} />}
        title="Page not found"
        description="The page you are looking for does not exist or may have moved."
        action={
          <Button component={RouterLink} to="/" variant="contained">
            Back to overview
          </Button>
        }
      />
    </Card>
  );
}
