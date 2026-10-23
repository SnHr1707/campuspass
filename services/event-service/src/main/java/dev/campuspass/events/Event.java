package dev.campuspass.events;

import java.io.Serializable;
import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

/** An event stored in MongoDB. Serializable so lists of events can be cached in Redis. */
@Document("events")
public record Event(
        @Id String id,
        String title,
        String description,
        String venue,
        String category,
        @Indexed Instant startsAt,
        int capacity,
        String organiserId,
        String organiserName,
        Instant createdAt) implements Serializable {

    Event withId(String newId) {
        return new Event(newId, title, description, venue, category, startsAt, capacity, organiserId, organiserName, createdAt);
    }
}
