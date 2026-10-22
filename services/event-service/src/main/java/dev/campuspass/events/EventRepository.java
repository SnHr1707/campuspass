package dev.campuspass.events;

import java.time.Instant;
import java.util.List;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface EventRepository extends MongoRepository<Event, String> {

    List<Event> findByStartsAtAfterOrderByStartsAtAsc(Instant after);

    List<Event> findByCategoryAndStartsAtAfterOrderByStartsAtAsc(String category, Instant after);
}
