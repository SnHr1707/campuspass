package dev.campuspass.events;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class EventService {

    private final EventRepository repository;
    private final Clock clock;

    public EventService(EventRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    /**
     * Upcoming events, cached in Redis for 30 seconds. During a rush every student
     * refreshes the event list; the cache keeps that load off MongoDB.
     */
    @Cacheable(value = "upcoming-events", key = "#category == null ? 'all' : #category")
    public List<Event> upcoming(String category) {
        Instant now = Instant.now(clock);
        List<Event> events = category == null
                ? repository.findByStartsAtAfterOrderByStartsAtAsc(now)
                : repository.findByCategoryAndStartsAtAfterOrderByStartsAtAsc(category, now);
        return new ArrayList<>(events);
    }

    public Optional<Event> find(String id) {
        return repository.findById(id);
    }

    @CacheEvict(value = "upcoming-events", allEntries = true)
    public Event create(EventRequest req, String organiserId, String organiserName) {
        Event event = new Event(
                null,
                req.title().trim(),
                req.description() == null ? "" : req.description().trim(),
                req.venue().trim(),
                req.category(),
                req.startsAt(),
                req.capacity(),
                organiserId,
                organiserName,
                Instant.now(clock));
        return repository.save(event);
    }
}
