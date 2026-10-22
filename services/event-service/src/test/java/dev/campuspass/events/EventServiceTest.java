package dev.campuspass.events;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class EventServiceTest {

    private final Instant now = Instant.parse("2026-10-11T10:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final EventRepository repository = mock(EventRepository.class);
    private final EventService service = new EventService(repository, clock);

    @Test
    void upcomingOnlyAsksForFutureEvents() {
        when(repository.findByStartsAtAfterOrderByStartsAtAsc(now)).thenReturn(List.of());
        assertThat(service.upcoming(null)).isEmpty();
        verify(repository).findByStartsAtAfterOrderByStartsAtAsc(now);

        when(repository.findByCategoryAndStartsAtAfterOrderByStartsAtAsc("tech", now)).thenReturn(List.of());
        service.upcoming("tech");
        verify(repository).findByCategoryAndStartsAtAfterOrderByStartsAtAsc("tech", now);
    }

    @Test
    void createTrimsInputAndRecordsOrganiser() {
        when(repository.save(any())).thenAnswer(inv -> ((Event) inv.getArgument(0)).withId("65f0c0ffee0000000000abcd"));
        EventRequest req = new EventRequest("  Robotics Expo ", null, " Hall B ", "tech", now.plusSeconds(3600), 50);

        Event saved = service.create(req, "org-9", "Kiran");

        ArgumentCaptor<Event> captor = ArgumentCaptor.forClass(Event.class);
        verify(repository).save(captor.capture());
        Event stored = captor.getValue();
        assertThat(stored.title()).isEqualTo("Robotics Expo");
        assertThat(stored.venue()).isEqualTo("Hall B");
        assertThat(stored.description()).isEmpty();
        assertThat(stored.organiserId()).isEqualTo("org-9");
        assertThat(stored.createdAt()).isEqualTo(now);
        assertThat(saved.id()).isEqualTo("65f0c0ffee0000000000abcd");
    }
}
