import { YStack, Text } from 'tamagui';

type PlaceholderScreenProps = {
  title: string;
  subtitle: string;
};

/** Shared empty-state used by the not-yet-built tab screens. */
export function PlaceholderScreen({ title, subtitle }: PlaceholderScreenProps) {
  return (
    <YStack flex={1} bg="$background" ai="center" jc="center" gap="$2" p="$4">
      <Text fontSize="$9" fontWeight="700" color="$color">
        {title}
      </Text>
      <Text fontSize="$4" color="$placeholderColor" textAlign="center">
        {subtitle}
      </Text>
    </YStack>
  );
}
