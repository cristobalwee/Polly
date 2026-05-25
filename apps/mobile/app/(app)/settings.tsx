import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateKalshiCredentialSchema,
  type CreateKalshiCredential,
  type KalshiEnvironment,
  type ValidationStatus,
} from '@polly/shared';
import { Controller, useForm } from 'react-hook-form';
import {
  Button,
  Card,
  H1,
  Paragraph,
  ScrollView,
  Separator,
  Spinner,
  Text,
  XStack,
  YStack,
} from 'tamagui';
import { FormField } from '../../components/FormField';
import { useAuthActions } from '../../hooks/useAuthActions';
import { useKalshiCredential } from '../../hooks/useKalshiCredential';
import { useManualSync } from '../../lib/portfolio';
import { useAuthStore } from '../../stores/auth';

/** Human-readable label + Tamagui color token per validation status. */
const STATUS_DISPLAY: Record<ValidationStatus, { label: string; color: string }> = {
  valid: { label: 'Validated', color: '$green10' },
  invalid: { label: 'Invalid credentials', color: '$red10' },
  unvalidated: { label: 'Not yet validated', color: '$yellow10' },
};

/** Coloured pill showing the latest Kalshi validation result. */
function StatusBadge({ status }: { status: ValidationStatus }) {
  const { label, color } = STATUS_DISPLAY[status];
  return (
    <XStack ai="center" gap="$2">
      <YStack width={8} height={8} borderRadius={4} bg={color} />
      <Text fontSize="$3" fontWeight="600" color={color}>
        {label}
      </Text>
    </XStack>
  );
}

/**
 * The "Connect Kalshi" section once a credential exists: shows metadata and
 * offers re-validation and disconnection.
 */
function ConnectedKalshi() {
  const { query, validate, disconnect } = useKalshiCredential();
  const credential = query.data?.credential;
  if (!credential) return null;

  const lastValidated = credential.lastValidatedAt
    ? new Date(credential.lastValidatedAt).toLocaleString()
    : 'never';

  return (
    <YStack gap="$3">
      <XStack jc="space-between" ai="center">
        <Text fontSize="$3" color="$placeholderColor">
          Key id
        </Text>
        <Text fontSize="$3" fontWeight="600" color="$color">
          {credential.keyId}
        </Text>
      </XStack>
      <XStack jc="space-between" ai="center">
        <Text fontSize="$3" color="$placeholderColor">
          Environment
        </Text>
        <Text fontSize="$3" fontWeight="600" color="$color">
          {credential.environment}
        </Text>
      </XStack>
      <XStack jc="space-between" ai="center">
        <Text fontSize="$3" color="$placeholderColor">
          Status
        </Text>
        <StatusBadge status={credential.validationStatus} />
      </XStack>
      <XStack jc="space-between" ai="center">
        <Text fontSize="$3" color="$placeholderColor">
          Last checked
        </Text>
        <Text fontSize="$3" color="$color">
          {lastValidated}
        </Text>
      </XStack>

      {validate.isError ? (
        <Text fontSize="$2" color="$red10">
          {(validate.error as Error).message}
        </Text>
      ) : null}
      {disconnect.isError ? (
        <Text fontSize="$2" color="$red10">
          {(disconnect.error as Error).message}
        </Text>
      ) : null}

      <XStack gap="$3" mt="$1">
        <Button
          flex={1}
          disabled={validate.isPending}
          icon={validate.isPending ? <Spinner /> : undefined}
          onPress={() => validate.mutate()}
        >
          {validate.isPending ? 'Checking…' : 'Re-validate'}
        </Button>
        <Button
          flex={1}
          bg="$red10"
          disabled={disconnect.isPending}
          onPress={() => disconnect.mutate()}
        >
          <Button.Text color="white" fontWeight="600">
            {disconnect.isPending ? 'Removing…' : 'Disconnect'}
          </Button.Text>
        </Button>
      </XStack>

      <ManualSyncSection />
    </YStack>
  );
}

/**
 * Manual-sync trigger — pulls fills/positions/balance for the current user on
 * demand. Toast-style: the inline status line below the button surfaces the
 * result of the most recent sync, then fades out after a few seconds.
 */
function ManualSyncSection() {
  const sync = useManualSync();
  const [toast, setToast] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null);

  // Auto-dismiss the toast after 5 seconds so the section settles back to
  // showing just the button — same UX as a real toast without an extra dep.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const onSync = async () => {
    try {
      const result = await sync.mutateAsync();
      if (result.status === 'ok') {
        setToast({
          tone: 'ok',
          message: `Synced — ${result.fillsIngested} new fill(s), ${result.positionsSynced} position(s).`,
        });
      } else {
        setToast({
          tone: 'err',
          message: result.error ?? 'Sync failed',
        });
      }
    } catch (err) {
      setToast({
        tone: 'err',
        message: err instanceof Error ? err.message : 'Sync failed',
      });
    }
  };

  return (
    <YStack gap="$2" mt="$2">
      <Separator />
      <Text fontSize="$3" color="$placeholderColor">
        Manually pull your latest balance, positions, and fills from Kalshi.
      </Text>
      <Button
        bg="$accent"
        disabled={sync.isPending}
        icon={sync.isPending ? <Spinner color="white" /> : undefined}
        onPress={() => void onSync()}
      >
        <Button.Text color="white" fontWeight="700">
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </Button.Text>
      </Button>
      {toast ? (
        <Text fontSize="$2" color={toast.tone === 'ok' ? '$green10' : '$red10'}>
          {toast.message}
        </Text>
      ) : null}
    </YStack>
  );
}

/** The "Connect Kalshi" section when no credential is stored yet: the form. */
function ConnectKalshiForm() {
  const { connect } = useKalshiCredential();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<CreateKalshiCredential>({
    resolver: zodResolver(CreateKalshiCredentialSchema),
    defaultValues: { keyId: '', privateKey: '', environment: 'demo' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await connect.mutateAsync(values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not connect Kalshi.');
    }
  });

  return (
    <YStack gap="$3">
      <Paragraph fontSize="$3" color="$placeholderColor">
        Paste the API key id and PEM private key from your Kalshi account.
        They are encrypted before being stored — polly never shows the key
        again.
      </Paragraph>

      <FormField
        control={control}
        name="keyId"
        label="Key id"
        placeholder="e.g. 1a2b3c4d-…"
        autoCapitalize="none"
      />
      <FormField
        control={control}
        name="privateKey"
        label="Private key (PEM)"
        placeholder={'-----BEGIN PRIVATE KEY-----\n…'}
        autoCapitalize="none"
        multiline
      />

      <Controller
        control={control}
        name="environment"
        render={({ field: { value, onChange } }) => (
          <YStack gap="$1.5">
            <Text fontSize="$3" color="$placeholderColor">
              Environment
            </Text>
            <XStack gap="$2">
              {(['demo', 'production'] as KalshiEnvironment[]).map((env) => (
                <Button
                  key={env}
                  flex={1}
                  size="$3"
                  borderWidth={1}
                  borderColor={value === env ? '$accent' : '$borderColor'}
                  bg={value === env ? '$accent' : '$background'}
                  onPress={() => onChange(env)}
                >
                  <Button.Text color={value === env ? 'white' : '$color'}>
                    {env}
                  </Button.Text>
                </Button>
              ))}
            </XStack>
          </YStack>
        )}
      />

      {submitError ? (
        <Text fontSize="$2" color="$red10">
          {submitError}
        </Text>
      ) : null}

      <Button
        bg="$accent"
        disabled={formState.isSubmitting}
        opacity={formState.isSubmitting ? 0.6 : 1}
        icon={formState.isSubmitting ? <Spinner color="white" /> : undefined}
        onPress={onSubmit}
      >
        <Button.Text color="white" fontWeight="700">
          {formState.isSubmitting ? 'Connecting & validating…' : 'Connect Kalshi'}
        </Button.Text>
      </Button>
    </YStack>
  );
}

/** Settings — account info, sign-out, and the Kalshi connection. */
export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const { signOut } = useAuthActions();
  const { query } = useKalshiCredential();
  const [signingOut, setSigningOut] = useState(false);

  const hasCredential = Boolean(query.data?.credential);

  return (
    <ScrollView flex={1} bg="$background" contentContainerStyle={{ padding: 20 }}>
      <YStack gap="$5" maxWidth={560} width="100%" alignSelf="center">
        <H1 fontSize="$9" fontWeight="800" color="$color">
          Settings
        </H1>

        {/* Account */}
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
          <Text fontSize="$5" fontWeight="700" color="$color">
            Account
          </Text>
          <XStack jc="space-between" ai="center">
            <Text fontSize="$3" color="$placeholderColor">
              Signed in as
            </Text>
            <Text fontSize="$3" fontWeight="600" color="$color">
              {user?.email ?? '—'}
            </Text>
          </XStack>
          <Separator />
          <Button
            bg="$red10"
            disabled={signingOut}
            onPress={async () => {
              setSigningOut(true);
              try {
                await signOut();
              } finally {
                setSigningOut(false);
              }
            }}
          >
            <Button.Text color="white" fontWeight="600">
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button.Text>
          </Button>
        </Card>

        {/* Kalshi connection */}
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
          <Text fontSize="$5" fontWeight="700" color="$color">
            Connect Kalshi
          </Text>

          {query.isLoading ? (
            <XStack ai="center" jc="center" p="$4">
              <Spinner color="$accent" />
            </XStack>
          ) : query.isError ? (
            <YStack gap="$2">
              <Text fontSize="$3" color="$red10">
                Could not load your Kalshi connection.
              </Text>
              <Button size="$3" onPress={() => query.refetch()}>
                Retry
              </Button>
            </YStack>
          ) : hasCredential ? (
            <ConnectedKalshi />
          ) : (
            <ConnectKalshiForm />
          )}
        </Card>
      </YStack>
    </ScrollView>
  );
}
